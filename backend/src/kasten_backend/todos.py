"""Finding every todo in the vault, by reading the vault, and the project each is in.

One rg pass over the notes, the same way search reads them and for the same
reason: the files are the source of truth, so nothing here is indexed and
nothing here can go stale.

The backend hands each line over whole and serves no state or field, because
the editor has to parse a line anyway and two parsers in two languages drift.
The one thing it works out is the project, which needs a line's indent, its
tags and its links: an agent reading the endpoint then sees the lane the board
draws, without a copy of the rule of its own. To find the words the tags and
links are read from, it takes the fields off the way the editor does, a port of
`readFields` kept as narrow as that job. Links are read by `links.py`, whose
rule both sides test against one file of cases.
"""

import re
import sys
import unicodedata
from typing import TYPE_CHECKING

from kasten_backend.frontmatter import body_start
from kasten_backend.links import WIKILINK, code_spans, link_path
from kasten_backend.search import scan_vault

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.search import Hit

MOST_TODOS = 100_000
"""How many matching lines come back at most.

A backstop against one generated file with a million list items in it, not a
limit on how much work a person is willing to read. 5,000 said the second while
doing the first: it is a judgment about reading, and reaching it truncates
silently, so the client draws a shorter list than the vault holds with nothing
on screen to say so. A short list is worse than a long one, so the number now
sits where nothing written by hand reaches it.
"""

TODO_LINE = r"^[ \t]*- \[[ /xXbwr-]\]([ \t]|$)"
"""A checkbox list item at any indent, in any of the seven states.

`X` is in the class because another editor may write it and the frontend reads
it as done. `R` is not, because nothing writes it and the frontend reads
`[R]` as no todo. `[` is not either, which is what keeps `- [[borges]]` out. The `- ` anchor
is what keeps an ordered list item out. The `-` sits last in the class, where a
character class reads it as itself rather than as a range.
"""

SESSION_LINE = r"^[ \t]*- [0-9]{2}:[0-9]{2}-([ \t]|$)"
"""One line of a `## Time` section, running: a start time and no end.

The scan answers one view, and that view wants to know which rows are running.
A closed session tells it nothing the task line does not already carry, its
total being written there on every stop, and the closed ones are the only lines
in this feature that pile up. So the end time is out of the pattern rather than
optional in it, which keeps a response refetched on every write to the vault as
small as the number of timers actually going.

A stop reads the closed ones another way, through `GET /api/search` on the
todo's id: one narrow pass at the press, for one todo.
"""

TODO_PATTERN = f"{TODO_LINE}|{SESSION_LINE}"


async def find_todos(root: Path, skip: str | None = None) -> list[Hit]:
    """Every todo line and every time session line the vault holds, up to `MOST_TODOS`.

    `skip` names a folder to walk past, which is how the archive stays off the
    todo list by default. A finished project's open checkboxes are the clearest
    case of work that is not work: they are true of the note and false of the
    week, and left in they are the rows that make the pane not worth opening.
    """
    # `-e` so the pattern, which opens with a caret and holds a dash, is a
    # pattern and not a flag.
    return await scan_vault(root, ("-e", TODO_PATTERN), MOST_TODOS, skip)


PROJECT_ROOTS = ("02 Projects", "03 Areas")
"""The folders whose subfolders are projects.

Fixed rather than a setting: a vault without them sees every todo in no
project, and a rule per vault would have to reach every reader of the lines.
Areas count because client work lives there; resources do not, or every
reading list would be a project.
"""

LINK_ROOT = "02 Projects"
"""The one root a link or a tag files a todo under.

Not areas: a daily todo names people far more often than projects, and the
people live in `03 Areas/08 People`. A tag would have to spell an area's
number, `06 Allianz Direct`, which nobody types.
"""

# Every Unicode number, `\p{N}`, which `re` cannot name. `\d` is only the
# decimal digits, so `Ⅳ`, `½` and `²` would pass for a tag's non-number. One
# walk over the code points at import, a fraction of a second.
_NUMBERS = re.escape(
    "".join(c for c in map(chr, range(sys.maxunicode + 1)) if unicodedata.category(c)[0] == "N")
)

TAG = re.compile(r"(?<![\w/])#(?=[\w/-]*(?:[^\W" + _NUMBERS + r"]|[/-]))[\w/-]+")
"""`#tag` by the rule in `docs/reference/tag-format.md`.

`\\w` is a letter, a number or `_`, as `[\\p{L}\\p{N}_]` is. The lookahead wants
one character of the run that is no number, so `#1on1` is a tag and `#1984`
none. A lookbehind keeps `note#2x` and `a.io/p#x` out. Run it on text with
every span masked, as `tags_in` does, or a hash in code or a link reads as one.
"""

LINE = re.compile(
    r"([ \t]*)- \[[ /xXbwr-]\](?:[ \t]([^\r\n\N{LINE SEPARATOR}\N{PARAGRAPH SEPARATOR}]*))?"
)
"""A todo as the editor's `parseTodo` takes one, the words after the box captured.

Narrower than `TODO_LINE`: the editor's `.` matches no `\\r`, U+2028 or
U+2029, so a line holding one is no todo there, and so it is none here either,
neither filed nor anybody's parent. rg matches it all the same.
"""

# The fields `readFields` in the editor's `todo.ts` takes off a todo's words,
# spelled the same and taken in the same order, because one taken first can
# change where a free-text one ends. A link inside a field's value is no link
# the todo is filed by, the words being only what is left. Each marker may
# carry the variation selector. `[0-9]` and the spelled-out `\^` class because
# the editor's `\d` and `\w` are ASCII and Python's are not.
_VS = "\N{VARIATION SELECTOR-16}?"
# Spelled out where it is alone, since ruff takes the glyph for a plus sign.
_CREATED = "\N{HEAVY PLUS SIGN}"
_STOP = "📅|📆|🗓|⏳|🛫|" + _CREATED + "|✅|❌|🔺|⏫|🔼|🔽|⏬|🏁|🆔|⛔|⏲|⏱"
"""Every marker but `🔁` and `👤`, each of which ends the other's free text."""
_WORD = (
    r"([^ \t\n\x0b\f\r\N{NO-BREAK SPACE}\N{OGHAM SPACE MARK}\N{EN QUAD}-\N{HAIR SPACE}"
    r"\N{LINE SEPARATOR}\N{PARAGRAPH SEPARATOR}\N{NARROW NO-BREAK SPACE}"
    r"\N{MEDIUM MATHEMATICAL SPACE}\N{IDEOGRAPHIC SPACE}\N{ZERO WIDTH NO-BREAK SPACE}]+)"
)
"""The editor's `(\\S+)`, spelled out: Python's `\\s` holds U+0085 and U+001C to
U+001F, which the editor's does not, and leaves out U+FEFF, which it holds."""
_DATE = r"[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})"
_BLOCK_ID = r"\^[A-Za-z0-9_-]+[ \t]*$"
FIELDS = (
    re.compile("(?:📅|📆|🗓)" + _VS + _DATE),
    re.compile("⏳" + _VS + _DATE),
    re.compile("🛫" + _VS + _DATE),
    re.compile("(🔺|⏫|🔼|🔽|⏬)" + _VS),
    re.compile(
        "🔁"
        + _VS
        + r"[ \t]+(.+?)(?=[ \t]*(?:"
        + _STOP
        + r"|👤|#)|[ \t]+"
        + _BLOCK_ID
        + r"|[ \t]*$)"
    ),
    re.compile("🏁" + _VS + r"[ \t]+(keep|delete)(?=[ \t]|$)"),
    re.compile(_CREATED + _VS + _DATE),
    re.compile("✅" + _VS + _DATE),
    re.compile("❌" + _VS + _DATE),
    re.compile("⏲" + _VS + r"[ \t]+" + _WORD),
    re.compile("⏱" + _VS + r"[ \t]+" + _WORD),
    re.compile("🆔" + _VS + r"[ \t]+" + _WORD),
)
BLOCKED_BY = re.compile("⛔" + _VS + r"[ \t]+" + _WORD)
WAITING = re.compile(
    "👤" + _VS + r"(?:" + _DATE + r")?(?:[ \t]+(.+?))??"
    r"(?=[ \t]+(?:" + _STOP + r"|🔁|#|" + _BLOCK_ID + r")|[ \t]*$)"
)

SPANS = re.compile(r"\[\[[^\[\]\n]+\]\]|\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]*`|<!--[^\n]*?-->")
"""A link, a markdown link, a code span and an HTML comment closed on its line.

A marker inside one is not a field, nor a tag. The editor's `SPANS` in
`tag-rule.ts` is the same pattern, and rg reads it too, through `tags.py`.
"""


def mask(text: str) -> str:
    """`text` with every span blanked to no-break spaces, its spaces and offsets kept.

    Public because `tags.py` reads the tag vocabulary through it too, so that
    completion offers no tag the board and the editor would not read as one.
    """
    return SPANS.sub(lambda span: re.sub(r"[^ \t]", "\N{NO-BREAK SPACE}", span[0]), text)


def line_tags(text: str) -> list[tuple[int, int]]:
    """Where one line holds a tag, as `(start, end)` offsets, its spans and links masked.

    A line on its own is no fence, so a todo whose words open with three
    backticks keeps its tags, as the editor's `tagsOf` reads them.
    """
    return [found.span() for found in TAG.finditer(mask(text))]


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

    `GET /api/tags`, the graph and the mentions all read a note's tags here, and
    the todos read a line's through `line_tags`, so none of them can call a hash
    a tag that another does not. The frontmatter, HTML comments and code, fenced,
    indented or inline, are blanked first, the offsets kept.
    """
    body = body_start(text)
    hidden = [(0, body)] if body else []
    # Most notes hold no fence, comment or indented hash, and for those the
    # parse `code_spans` makes is skipped: it is most of the time a vault's
    # tags take.
    if "```" in text or "~~~" in text or "<!--" in text or INDENTED.search(text, body):
        # The block as spaces, which the parser reads as blank lines, so an
        # indented line under it opens code as it does under a blank line.
        hidden += code_spans(_blanked(text, hidden, " "), indented=True)
        # Looked for with the code blanked: a `<!--` in code opens no comment,
        # and paired with a real `-->` below it would hide the tags between.
        hidden += [found.span() for found in COMMENT.finditer(_blanked(text, hidden, " "))]
    if not hidden:
        return line_tags(text)
    return line_tags(_blanked(text, hidden, "\N{NO-BREAK SPACE}"))


def _words(rest: str) -> str:
    """A todo's words: what follows the box with every field taken out, as `readFields` leaves it.

    Each field is found on a copy with every span blanked to a no-break space,
    so a marker inside a link is no marker and a one-word value cannot run into
    one, and cut from both. A match with no value is no field, and only the
    first match of each is tried, as in the editor; only `⛔` repeats.
    """
    text = rest
    masked = mask(rest)
    for pattern in (*FIELDS, BLOCKED_BY, WAITING):
        while (found := pattern.search(masked)) is not None and any(found.groups()):
            text = text[: found.start()] + text[found.end() :]
            masked = masked[: found.start()] + masked[found.end() :]
            if pattern is not BLOCKED_BY:
                break
    # As the editor squeezes the words, so `[[FDE  Kickoff]]` names `FDE Kickoff`.
    return re.sub(r"[ \t]+", " ", text)


def _project_in(path: str, roots: tuple[str, ...]) -> str | None:
    """The project folder `path` lies in under one of `roots`, at any depth."""
    # Root, folder and at least the file: a note directly in a root is in none.
    root, _, rest = path.partition("/")
    folder, slash, _ = rest.partition("/")
    if root not in roots or not slash:
        return None
    return f"{root}/{folder}"


def _spoken(name: str) -> str:
    """A folder name or a tag's word as compared: no case, and `-` or `_` for a space."""
    return name.lower().replace("-", " ").replace("_", " ")


def _tag_project(text: str, folders: dict[str, str]) -> str | None:
    """The folder the first `#p/x` tag on `text` that names one names.

    A tag naming nothing is passed over, as a link to a missing note is: a typo
    would otherwise make a project nobody made. `#p/x/y` names `x`, a project
    being one folder deep.
    """
    for start, end in line_tags(text):
        tag = text[start:end]
        if tag[1:3].lower() != "p/":
            continue
        folder = folders.get(_spoken(tag[3:].split("/")[0]))
        if folder is not None:
            return folder
    return None


def _link_project(text: str, paths: list[str]) -> str | None:
    """The project of the first link on `text` that lands on a note in one."""
    for target in WIKILINK.findall(text):
        # A name of only spaces is no name, as the editor's `wikiLinkTargets` has it.
        if not target.strip():
            continue
        linked = link_path(target, paths)
        if linked not in paths:
            continue
        project = _project_in(linked, (LINK_ROOT,))
        if project is not None:
            return project
    return None


def projects_of(hits: list[Hit], paths: list[str]) -> list[str | None]:
    """The project of each hit, in the order of `hits`, against the notes in `paths`.

    For a todo, the first of: a `#p/x` tag on it or on the nearest todo it is a
    part of; the note's project folder; the first link on it into a project;
    the project of the todo it is a part of. A session line is no todo, so it
    has none and is no todo's parent.

    A part is a child of the nearest todo above it with a smaller indent, as
    the editor's `treeOf` reads one, prose between the two ending nothing.
    """
    # Only folders something is filed in: an empty one is no project to name.
    folders: dict[str, str] = {}
    for path in paths:
        project = _project_in(path, (LINK_ROOT,))
        if project is not None:
            folders.setdefault(_spoken(project.split("/")[1]), project)

    found: dict[tuple[str, int], str | None] = {}
    by_note: dict[str, list[Hit]] = {}
    for hit in hits:
        by_note.setdefault(hit.path, []).append(hit)

    for note, lines in by_note.items():
        folder = _project_in(note, PROJECT_ROOTS)
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
