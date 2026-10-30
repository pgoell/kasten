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
from kasten_backend.search import scan_vault
from kasten_backend.todo_fields import SPANS, blank, mask
from kasten_backend.todo_fields import words as _words

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.search import Hit

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

TODO_PATTERN = f"{TODO_LINE}|{SESSION_LINE}"


async def find_todos(root: Path, skip: str | None = None) -> list[Hit]:
    """Every todo line and every time session line the vault holds, up to `MOST_TODOS`.

    `skip` names a folder to walk past: the archive, by default. A finished project's open
    checkboxes are true of the note and false of the week, so they are left out.
    """
    # `-e` so the pattern, which opens with a caret and holds a dash, is a
    # pattern and not a flag.
    return await scan_vault(root, ("-e", TODO_PATTERN), MOST_TODOS, skip)


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

COMMENT_OPENING = r"^ {0,3}<!--[^\n]*"
LINE_SPANS = re.compile(f"{COMMENT_OPENING}|{SPANS.pattern}")
"""`SPANS` and, first, a comment opening the line, for a reader holding a whole line.

A `<!--` opening a line starts an HTML block, which takes the whole line, so no tag after
it counts. Not in `SPANS`: a todo's `<!--` after its box is a plain comment.
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

COMMENT_LINE = re.compile(r"^ {0,3}<!--", re.MULTILINE)
"""A `<!--` opening a line, three spaces in front at most: an HTML block by CommonMark."""


def _comment_blocks(text: str, base: str) -> list[tuple[int, int]]:
    """Where `text` holds an HTML block that a `COMMENT_LINE` opens, read on `base`.

    `base` is `text` with code blanked, so a `<!--` in code opens nothing. The block runs
    to the end of the first line holding `-->`, so `<!-- x --> #a` hides `#a`; one never
    closed runs to the end of the note.
    """
    blocks: list[tuple[int, int]] = []
    end = 0
    for found in COMMENT_LINE.finditer(base):
        # A `<!--` inside a block already found opens nothing, and nor does one
        # whose spaces in front are a code span blanked, as in `` `a`<!-- ``.
        if found.start() < end or text[found.start() : found.end()] != found[0]:
            continue
        close = text.find("-->", found.start())
        if close == -1:
            blocks.append((found.start(), len(text)))
            break
        end = text.find("\n", close)
        end = len(text) if end == -1 else end
        blocks.append((found.start(), end))
    return blocks


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
        hidden += code_spans(_blanked(text, hidden, " "), indented=True)
        # Looked for with the code blanked: a `<!--` in code opens no comment,
        # and paired with a real `-->` below it would hide the tags between.
        base = _blanked(text, hidden, " ")
        hidden += _comment_blocks(text, base)
        hidden += [found.span() for found in COMMENT.finditer(base)]
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
    folder, the first link into a project, the parent's project. A parent is the nearest
    todo above with a smaller indent, prose between them or not. A session line has none.
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
            if todo is None:
                continue
            # A tab counts one, as the editor's `parseTodo` counts it.
            indent = len(todo[1])
            while above and above[-1][0] >= indent:
                above.pop()
            parent_tag, parent = (above[-1][1], above[-1][2]) if above else (None, None)

            # Tags and links off the words, as the board read `todo.tags` and
            # `todo.text`, so neither counts inside a field's value.
            words = _words(todo[2] or "")
            tagged = _tag_project(words, folders) or parent_tag
            project = tagged or folder or _link_project(words, paths) or parent
            found[(note, hit.line)] = project
            above.append((indent, tagged, project))

    return [found.get((hit.path, hit.line)) for hit in hits]
