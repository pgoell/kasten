"""Finding every todo in the vault, by reading the vault, and the project each is in.

Each note's lines read as search's rg reads them, held per note (#1758). The backend hands
each line over whole and serves no state, since the editor parses a line too and two parsers
drift. It works out only the project, from indent, tags and links.
"""

import asyncio
import re
import sys
import unicodedata
from bisect import bisect_right
from typing import TYPE_CHECKING

from kasten_backend.code_spans import BLOCK_NAMES, FENCES, WIKILINK, blocks
from kasten_backend.frontmatter import body_start
from kasten_backend.links import link_path
from kasten_backend.search import Hit, rg_lines, rg_order, skipped
from kasten_backend.todo_fields import SPANS, blank, mask
from kasten_backend.todo_fields import words as _words
from kasten_backend.vault import note_facts

if TYPE_CHECKING:
    from collections.abc import Iterable
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

FENCE_LINE = r"^[ \t]*(```|~~~)"
"""A line that may open or close a fence, asked for so a note holding one is read whole.

Any indent, since a fence under a nested list item sits four or more spaces in (#1555).
"""

TODO_PATTERN = f"{TODO_LINE}|{SESSION_LINE}|{FENCE_LINE}"

FENCE = re.compile(r"[ \t]*(`{3,}|~{3,})")
HEADING = re.compile(r" {0,3}#{1,6}(?:[ \t]|$)")
ITEM = re.compile(r"([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]|$)")


def fenced_lines(lines: list[str]) -> set[int]:
    """The indexes of the lines in a fence, its own lines too, by markdown-it (#1555).

    The parser, not a line reader, so an opener under a nested list item counts.
    """
    tokens = FENCES.parse("\n".join(lines).replace("\r", " "))
    return {
        index
        for token in tokens
        if token.type == "fence" and token.map is not None
        for index in range(*token.map)
    }


def stop_of(text: str) -> int | None:
    """The indent at which a line that is no todo ends the parts above it, -1 for a heading.

    The editor's `stopOf`; `backend/tests/fixtures/todo_parts.json` holds the two together.
    """
    if HEADING.match(text):
        return -1
    item = ITEM.match(text)
    return None if item is None else len(item[1])


def parents(lines: Iterable[tuple[int, str]]) -> dict[int, int | None]:
    """The todo each todo line is a part of, by line number, or None: every parts reader's walk.

    `lines` come in order, with no line break in them. A line that is no todo ends parts by
    `stop_of`.
    """
    found: dict[int, int | None] = {}
    above: list[tuple[int, int | None]] = []
    for number, text in lines:
        todo = LINE.fullmatch(text)
        # A tab counts one, as the editor's `parseTodo` counts it.
        indent = len(todo[1]) if todo else stop_of(text)
        if indent is None:
            continue
        while above and above[-1][0] >= indent:
            above.pop()
        if todo is not None:
            found[number] = above[-1][1] if above else None
        # A heading or a plain item ends the parts, holding what sits under it apart.
        above.append((indent, None if todo is None else number))
    return found


def _whole(note: str, hits: list[Hit], raw: bytes) -> list[Hit]:
    """A note's hits, fenced lines out and, under an indented todo, the lines ending parts in.

    Only lines between the first todo and the last indented one can end a part, so only those go.
    """
    marks = [hit for hit in hits if FENCE.match(hit.text)]
    hits = [hit for hit in hits if hit not in marks]
    nested = [hit.line for hit in hits if hit.text[:1] in " \t" and LINE.fullmatch(hit.text)]
    if not hits or (not marks and not nested):
        return hits
    # Universal newlines, as a text read gives them.
    text = raw.decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
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


_TODO = re.compile(TODO_PATTERN)


def _parse(note: str, raw: bytes) -> tuple[list[Hit], list[int]]:
    """A note's todo lines and what ends parts, and the lines the pattern matched."""
    # rg keeps a CRLF line's `\r`; the note read answers it as LF, and so do we (#1705).
    hits = [
        Hit(note, at + 1, line.removesuffix("\r"))
        for at, line in enumerate(rg_lines(raw))
        if _TODO.match(line)
    ]
    return _whole(note, hits, raw), [hit.line for hit in hits]


def _todos(root: Path, skip: str | None) -> list[Hit]:
    found: list[Hit] = []
    room = MOST_TODOS
    held = note_facts(root, "todos", _parse, ([], []))
    for path in sorted(held, key=rg_order):
        hits, matched = held[path]
        if room <= 0:
            break
        if not skipped(path, skip):
            # Past the cap, the lines after the last matched line it lets in go too, as rg stops.
            last = matched[room - 1] if len(matched) > room else None
            found.extend(hit for hit in hits if last is None or hit.line <= last)
            room -= len(matched)
    return found


async def find_todos(root: Path, skip: str | None = None) -> list[Hit]:
    """Every todo and running session line outside a fence, and what ends parts.

    `skip` names a folder to walk past: the archive, whose open checkboxes are past work.
    Stops after `MOST_TODOS` matched lines.
    """
    return await asyncio.to_thread(_todos, root, skip)


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

HTML_OPENER = (
    r"(?i:<!--|<(?:script|pre|style)(?:\s|>|$)|<\?|<![a-z]|<!\[CDATA\[|</?(?:"
    + BLOCK_NAMES
    + r")(?:\s|/?>|$))"
)
"""What opens an HTML block that may break a paragraph, kinds 1 to 6, by the editor's names.

A lone tag, kind 7, may not, so only `tags_in`'s parse places it. `tag-rule.ts` agrees.
"""

MARKERS = r"^ {0,3}(?:(?:>|(?:[-*+]|[0-9]{1,9}[.)])[ \t])[ \t]{0,4})*"
BLOCK_OPENING = rf"{MARKERS}{HTML_OPENER}[^\n]*"
LINE_SPANS = re.compile(f"{BLOCK_OPENING}|{SPANS.pattern}")
"""`SPANS` and, first, an HTML block opening the line or a list item or quote on it.

The block takes the whole line, so no tag after it counts. Not in `SPANS`: a todo's `<!--`
or `<div>` after its box is inline HTML. Each pass opens on a marker, so a line of `> `
cannot backtrack exponentially.
"""

HTML_LINE = r"^(?:[ \t>]|(?:[-*+]|[0-9]{1,9}[.)])[ \t])*<(?:[A-Za-z/?]|![A-Za-z\[])"
"""A line that may open an HTML block other than a comment: a superset, costing a parse.

Only the parse says where such a block ends, or whether a lone tag opens one at all.
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


HTML_LINES = re.compile(HTML_LINE, re.MULTILINE)

_BREAK = r"\n(?![ \t]*\n)"
COMMENT = re.compile(rf"<!--(?:[^>\n]|{_BREAK})(?:-?(?:[^-\n]|{_BREAK}))*?-->")
"""An inline comment as the editor reads one: within its paragraph, no `--` inside.

So no blank line (#1475) and no `--` (#1474) sits in it, and `<!-->` opens none (#657).
"""


INDENTED = re.compile(r"^(?:[ \t>]|(?:[-*+]|[0-9]{1,9}[.)])[ \t])*(?: {4}|\t).*#", re.MULTILINE)
"""A line indented as far as code is, after markers or not, holding a hash: a tag in code, maybe."""


def _blanked(text: str, spans: list[tuple[int, int]], filler: str) -> str:
    """`text` with every span blanked to `filler`, its line breaks and offsets kept."""
    blanked = list(text)
    for start, end in spans:
        for index in range(start, end):
            # A line break stays, or a fence's lines would run into one.
            if blanked[index] != "\n":
                blanked[index] = filler
    return "".join(blanked)


def _comments(
    code: str, start: int, end: int, inline: list[tuple[int, int]]
) -> list[tuple[int, int]]:
    """`COMMENT`'s spans in `code[start:end]`, where of a comment and an inline span the first wins.

    So a `--` in a span inside a comment still ends it, and a `<!--` in a span opens none (#1594).
    """
    found = []
    while match := COMMENT.search(code, start, end):
        index = bisect_right(inline, match.start(), key=lambda span: span[0])
        if index and inline[index - 1][1] > match.start():
            start = inline[index - 1][1]
            continue
        found.append(match.span())
        start = match.end()
    return found


def tags_in(text: str) -> list[tuple[int, int]]:
    """Where a whole note holds a tag, as `(start, end)` offsets.

    Every reader of tags goes through here or `line_tags`, so none calls a hash a tag that
    another does not. Frontmatter, comments and code are blanked first.
    """
    body = body_start(text)
    hidden = [(0, body)] if body else []
    # Most notes hold no fence, HTML block or indented hash, so the parse is skipped:
    # it is most of the time a vault's tags take.
    html = "<!--" in text or HTML_LINES.search(text, body) is not None
    if "```" in text or "~~~" in text or html or INDENTED.search(text, body):
        # The block as spaces, which the parser reads as blank lines, so an
        # indented line under it opens code as it does under a blank line.
        code_held, texts = blocks(_blanked(text, hidden, " "), indented=True, html=html)
        hidden += code_held
        # Looked for with the blocks of code blanked: a `<!--` in one opens no comment,
        # and paired with a real `-->` below it would hide the tags between.
        inline = [span for span in hidden if "\n" not in text[span[0] : span[1]]]
        code = _blanked(text, [span for span in hidden if "\n" in text[span[0] : span[1]]], " ")
        # A comment closes with its paragraph, which a heading or list item also ends (#1544).
        hidden += [found for start, end in texts for found in _comments(code, start, end, inline)]
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
        # rg answers in any order, and a parent has to come before its parts.
        ordered = sorted(lines, key=lambda one: one.line)
        up = parents((hit.line, hit.text) for hit in ordered)
        tags: dict[int, str | None] = {}
        for hit in ordered:
            todo = LINE.fullmatch(hit.text)
            if todo is None or hit.line not in up:
                continue
            parent = up[hit.line]
            # Tags and links off the words, as the board read `todo.tags` and
            # `todo.text`, so neither counts inside a field's value.
            words = _words(todo[2] or "")
            tagged = _tag_project(words, folders) or tags.get(parent)
            above = None if parent is None else found.get((note, parent))
            project = tagged or folder or _link_project(words, paths) or above
            found[(note, hit.line)] = project
            tags[hit.line] = tagged

    return [found.get((hit.path, hit.line)) for hit in hits]
