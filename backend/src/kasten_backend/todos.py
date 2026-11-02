"""Finding every todo in the vault, by reading the vault, and the project each is in.

One rg pass over the notes, as search reads them, so nothing here is indexed or goes stale.
The backend hands each line over whole and serves no state, since the editor parses a line
too and two parsers drift. It works out only the project, from indent, tags and links.
"""

import re
import sys
import unicodedata
from typing import TYPE_CHECKING

from kasten_backend.code_spans import WIKILINK, code_spans
from kasten_backend.frontmatter import body_start
from kasten_backend.links import link_path
from kasten_backend.search import Hit, scan_vault
from kasten_backend.todo_fields import SPANS, blank, mask
from kasten_backend.todo_fields import words as _words

if TYPE_CHECKING:
    from pathlib import Path

MOST_TODOS = 100_000
"""How many matching lines come back at most.

A backstop against one generated file, not a limit on work a person reads. Reaching it
truncates silently, so the cap sits where nothing written by hand reaches it.
"""

TODO_LINE = r"^[ \t]*- \[[ /xXbwr-]\]([ \t]|$)"
"""A checkbox list item at any indent, in any of the seven states.

`X` is in the class because the frontend reads it as done. `R` and `[` are not: nothing
writes `R`, and `[` keeps out `- [[borges]]`. The `- ` anchor keeps out an ordered item.
The `-` sits last in the class, so it is a dash, not a range.
"""

SESSION_LINE = r"^[ \t]*- [0-9]{2}:[0-9]{2}-([ \t]|$)"
"""One line of a `## Time` section, running: a start time and no end.

Closed sessions are left out so a response refetched on each vault write stays small. A
stop reads them through `GET /api/search` on the todo's id instead.
"""

FENCE_LINE = r"^ {0,3}(```|~~~)"
"""A line that may open or close a fence, asked for so a note holding one is read whole."""

TODO_PATTERN = f"{TODO_LINE}|{SESSION_LINE}|{FENCE_LINE}"

FENCE = re.compile(r" {0,3}(`{3,}|~{3,})(.*)")
HEADING = re.compile(r" {0,3}#{1,6}(?:[ \t]|$)")
ITEM = re.compile(r"([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]|$)")


def fenced_lines(lines: list[str]) -> set[int]:
    """The indexes of the lines in a fence, its own lines too, as the editor's `fencedLines`."""
    coded: set[int] = set()
    opened: str | None = None
    for index, line in enumerate(lines):
        found = FENCE.match(line)
        fence, info = (found[1], found[2]) if found else (None, "")
        if opened is None and fence and (fence[0] == "~" or "`" not in info):
            opened = fence
        elif opened is not None:
            closes = fence and fence[0] == opened[0] and len(fence) >= len(opened)
            if closes and line.strip() == fence:
                opened = None
        else:
            continue
        coded.add(index)
    return coded


def stop_of(text: str) -> int | None:
    """The indent at which a line that is no todo ends the parts above it, -1 for a heading.

    The editor's `stopOf`; `backend/tests/fixtures/todo_parts.json` holds the two together.
    """
    if HEADING.match(text):
        return -1
    item = ITEM.match(text)
    return None if item is None else len(item[1])


def _whole(root: Path, note: str, hits: list[Hit]) -> list[Hit]:
    """A note's hits, fenced lines out and, under an indented todo, the lines ending parts in.

    Only lines between the first todo and the last indented one can end a part, so only those go.
    """
    marks = [hit for hit in hits if FENCE.match(hit.text)]
    hits = [hit for hit in hits if hit not in marks]
    nested = [hit.line for hit in hits if hit.text[:1] in " \t" and LINE.fullmatch(hit.text)]
    if not hits or (not marks and not nested):
        return hits
    try:
        text = (root / note).read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return hits
    lines = [line.removesuffix("\r") for line in text.split("\n")]
    above = text[: body_start(text)].count("\n")
    coded = {at + above for at in fenced_lines(lines[above:])}
    kept = [hit for hit in hits if hit.line - 1 not in coded]
    seen = {hit.line for hit in kept}
    first = min(seen, default=0)
    ends = [
        Hit(note, at + 1, lines[at])
        for at in range(first, max(nested, default=0))
        if at + 1 not in seen and at not in coded and stop_of(lines[at]) is not None
    ]
    return sorted(kept + ends, key=lambda hit: hit.line)


async def find_todos(root: Path, skip: str | None = None) -> list[Hit]:
    """Every todo and running session line outside a fence, up to `MOST_TODOS`, and what ends parts.

    `skip` names a folder to walk past: the archive, whose open checkboxes are past work.
    """
    # `-e` so the pattern, which opens with a caret and holds a dash, is a
    # pattern and not a flag.
    found = await scan_vault(root, ("-e", TODO_PATTERN), MOST_TODOS, skip)
    by_note: dict[str, list[Hit]] = {}
    for hit in found:
        by_note.setdefault(hit.path, []).append(hit)
    return [hit for note, hits in by_note.items() for hit in _whole(root, note, hits)]


PROJECT_ROOTS = ("02 Projects", "03 Areas")
"""The folders whose subfolders are projects.

Fixed, not a setting, since a per-vault rule would reach every reader of the lines. Areas
count because client work lives there; resources do not, or every reading list would be a project.
"""

LINK_ROOT = "02 Projects"
"""The one root a link or a tag files a todo under.

Not areas: a daily todo names people far more often than projects, and the people live in
`03 Areas/08 People`. A tag would have to spell an area's number, which nobody types.
"""

# Every Unicode number, `\p{N}`, which `re` cannot name. `\d` only covers decimal digits,
# so `Ⅳ`, `½` and `²` would pass as a tag's non-number. One walk at import.
_NUMBERS = re.escape(
    "".join(c for c in map(chr, range(sys.maxunicode + 1)) if unicodedata.category(c)[0] == "N")
)

TAG = re.compile(r"(?<![\w/])#(?=[\w/-]*(?:[^\W" + _NUMBERS + r"]|[/-]))[\w/-]+")
"""`#tag` by the rule in `docs/reference/tag-format.md`.

The lookahead wants one character of the run that is no number, so `#1on1` is a tag and
`#1984` is none. Run it on text with spans masked, or a hash in code reads as one.
"""

LINE = re.compile(
    r"([ \t]*)- \[[ /xXbwr-]\](?:[ \t]([^\r\n\N{LINE SEPARATOR}\N{PARAGRAPH SEPARATOR}]*))?"
)
"""A todo as the editor's `parseTodo` takes one, the words after the box captured.

Narrower than `TODO_LINE`: the editor's `.` matches no carriage return, U+2028 or U+2029,
so a line holding one is no todo here either. rg matches it all the same.
"""

COMMENT_OPENING = r"^ {0,3}(?:(?:>|(?:[-*+]|[0-9]{1,9}[.)])[ \t]) {0,4})*<!--[^\n]*"
LINE_SPANS = re.compile(f"{COMMENT_OPENING}|{SPANS.pattern}")
"""`SPANS` and, first, a comment opening the line or a list item or quote on it.

That `<!--` starts an HTML block, which takes the whole line, so no tag after it counts.
Not in `SPANS`: a todo's `<!--` after its box is a plain comment. `tag-rule.ts` agrees.
Each pass opens on a marker, so a line of `> ` cannot backtrack exponentially.
"""


def word_tags(text: str) -> list[tuple[int, int]]:
    """Where `text`, which opens no line, holds a tag, as `(start, end)` offsets.

    A `<!--` in front here is a comment, not an HTML block, so it opens nothing.
    """
    return [found.span() for found in TAG.finditer(mask(text))]


def line_tags(text: str) -> list[tuple[int, int]]:
    """Where one line holds a tag, as `(start, end)` offsets, its spans and links masked.

    A line on its own is no fence, so a line opening with three backticks keeps its tags.
    """
    return [found.span() for found in TAG.finditer(blank(text, LINE_SPANS))]


COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
"""An HTML comment, over as many lines as it runs."""


INDENTED = re.compile(r"^(?: {4}|\t).*#", re.MULTILINE)
"""A line indented as far as code is, holding a hash: what may be a tag in code."""


def _blanked(text: str, spans: list[tuple[int, int]], filler: str) -> str:
    """`text` with every span blanked to `filler`, its line breaks and offsets kept."""
    blanked = list(text)
    for start, end in spans:
        for index in range(start, end):
            # A line break stays, or a fence's lines would run into one.
            if blanked[index] != "\n":
                blanked[index] = filler
    return "".join(blanked)


def tags_in(text: str) -> list[tuple[int, int]]:
    """Where a whole note holds a tag, as `(start, end)` offsets.

    Every reader of tags goes through here or `line_tags`, so none calls a hash a tag that
    another does not. Frontmatter, comments and code are blanked first.
    """
    body = body_start(text)
    hidden = [(0, body)] if body else []
    # Most notes hold no fence, comment or indented hash, so the parse is skipped:
    # it is most of the time a vault's tags take.
    if "```" in text or "~~~" in text or "<!--" in text or INDENTED.search(text, body):
        # The block as spaces, which the parser reads as blank lines, so an
        # indented line under it opens code as it does under a blank line.
        hidden += code_spans(_blanked(text, hidden, " "), indented=True, comments="<!--" in text)
        # Looked for with the code blanked: a `<!--` in code opens no comment,
        # and paired with a real `-->` below it would hide the tags between.
        hidden += [found.span() for found in COMMENT.finditer(_blanked(text, hidden, " "))]
    if not hidden:
        return line_tags(text)
    return line_tags(_blanked(text, hidden, "\N{NO-BREAK SPACE}"))


def project_in(path: str, roots: tuple[str, ...]) -> str | None:
    """The project folder `path` lies in under one of `roots`, at any depth.

    Public for the written notes, which fall back on the folder a note sits in
    the way a todo does.
    """
    # Root, folder and at least the file: a note directly in a root is in none.
    root, _, rest = path.partition("/")
    folder, slash, _ = rest.partition("/")
    if root not in roots or not slash:
        return None
    return f"{root}/{folder}"


def _spoken(name: str) -> str:
    """A folder name or a tag's word as compared: no case, and `-` or `_` for a space."""
    return name.lower().replace("-", " ").replace("_", " ")


def project_by_tag(tags: list[str], folders: dict[str, str]) -> str | None:
    """The folder the first `#p/x` in `tags` that names one names, in the order given.

    A tag naming nothing is passed over, as a link to a missing note is, so a typo does
    not make a project nobody made. `#p/x/y` names `x`: a project is one folder deep.
    """
    for tag in tags:
        if tag[1:3].lower() != "p/":
            continue
        folder = folders.get(_spoken(tag[3:].split("/")[0]))
        if folder is not None:
            return folder
    return None


def _tag_project(text: str, folders: dict[str, str]) -> str | None:
    """The project a line's own tags name, as `project_by_tag` reads them."""
    return project_by_tag([text[start:end] for start, end in word_tags(text)], folders)


def _link_project(text: str, paths: list[str]) -> str | None:
    """The project of the first link on `text` that lands on a note in one."""
    for target in WIKILINK.findall(text):
        # A name of only spaces is no name, as the editor's `wikiLinkTargets` has it.
        if not target.strip():
            continue
        linked = link_path(target, paths)
        if linked not in paths:
            continue
        project = project_in(linked, (LINK_ROOT,))
        if project is not None:
            return project
    return None


def project_folders(paths: list[str]) -> dict[str, str]:
    """Each project folder something is filed in, keyed by the name a `#p/x` tag spells.

    Public so the written notes name projects the same way, rather than by a second map
    that could drift. Only folders with a filed note appear.
    """
    folders: dict[str, str] = {}
    for path in paths:
        project = project_in(path, (LINK_ROOT,))
        if project is not None:
            folders.setdefault(_spoken(project.split("/")[1]), project)
    return folders


def projects_of(hits: list[Hit], paths: list[str]) -> list[str | None]:
    """The project of each hit, in the order of `hits`, against the notes in `paths`.

    For a todo, the first of: a `#p/x` tag on it or on its parent, the note's project
    folder, the first link into a project, the parent's project, the parent read as `stepIn`
    reads it (#1445). A line that is no todo has none.
    """
    folders = project_folders(paths)

    found: dict[tuple[str, int], str | None] = {}
    by_note: dict[str, list[Hit]] = {}
    for hit in hits:
        by_note.setdefault(hit.path, []).append(hit)

    for note, lines in by_note.items():
        folder = project_in(note, PROJECT_ROOTS)
        # The todos open above this one, shallowest first: indent, the tag
        # project it passes down, and its whole project.
        above: list[tuple[int, str | None, str | None]] = []
        # rg answers in any order, and a parent has to come before its parts.
        for hit in sorted(lines, key=lambda one: one.line):
            todo = LINE.fullmatch(hit.text)
            # A tab counts one, as the editor's `parseTodo` counts it.
            indent = len(todo[1]) if todo else stop_of(hit.text)
            if indent is None:
                continue
            while above and above[-1][0] >= indent:
                above.pop()
            if todo is None:
                # A heading or a plain item ends the parts, holding what sits under it apart.
                above.append((indent, None, None))
                continue
            parent_tag, parent = (above[-1][1], above[-1][2]) if above else (None, None)

            # Tags and links off the words, as the board read `todo.tags` and
            # `todo.text`, so neither counts inside a field's value.
            words = _words(todo[2] or "")
            tagged = _tag_project(words, folders) or parent_tag
            project = tagged or folder or _link_project(words, paths) or parent
            found[(note, hit.line)] = project
            above.append((indent, tagged, project))

    return [found.get((hit.path, hit.line)) for hit in hits]
