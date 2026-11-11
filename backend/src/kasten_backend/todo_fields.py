"""The field readers of a todo line: the markers its words carry, and the words and assignee left.

A port of the editor's `readFields` in `todo-fields.ts`, held to it by one table of cases.
It imports nothing from `todos.py`, which reads it.
"""

import re

# The fields `readFields` takes off a todo's words, in the editor's order, since one taken first
# moves where a free-text one ends. `[0-9]` and `\^` stand in for the editor's ASCII `\d` and `\w`.
_VS = "\N{VARIATION SELECTOR-16}?"
# Spelled out where it is alone, since ruff takes the glyph for a plus sign.
_CREATED = "\N{HEAVY PLUS SIGN}"
STOP = "📅|📆|🗓|⏳|🛫|" + _CREATED + "|✅|❌|🔺|⏫|🔼|🔽|⏬|🏁|🆔|⛔|⏲|⏱"
"""Every marker but `🔁` and `👤`, which end a free-text value by their own patterns."""
_WORD = (
    r"([^ \t\n\x0b\f\r\N{NO-BREAK SPACE}\N{OGHAM SPACE MARK}\N{EN QUAD}-\N{HAIR SPACE}"
    r"\N{LINE SEPARATOR}\N{PARAGRAPH SEPARATOR}\N{NARROW NO-BREAK SPACE}"
    r"\N{MEDIUM MATHEMATICAL SPACE}\N{IDEOGRAPHIC SPACE}\N{ZERO WIDTH NO-BREAK SPACE}]+)"
)
"""The editor's `(\\S+)`, spelled out: Python's `\\s` holds U+0085 and U+001C to
U+001F, which the editor's does not, and leaves out U+FEFF, which it holds."""
# A one-word value never starts with a marker, so `⏲` before `🆔 kt-1` takes the `🆔` as the next
# field. `👤` stays out on purpose: `⏲ 👤 2026-10-20` reads `👤` as the estimate, like the editor.
_ONE_WORD = r"[ \t]+(?!(?:" + STOP + r"|🔁))" + _WORD
_DATE = r"[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})"
DONE = re.compile("✅" + _VS + _DATE)
_BLOCK_ID = r"\^[A-Za-z0-9_-]+[ \t]*(?:\n|$)"
# The end of a free-text value is tried only after a non-blank, or at a cut or the line end, so
# a long blank run is read once (#1889). A `🔁` then blanks at the end still takes one blank.
_AFTER_WORD = r"(?:(?<![ \t])(?="
_AT_CUT = r")|(?=\n|$))"
# A `🔁` value runs to the next field, tag, `👤`, block id or cut, as the editor's does.
_RECURRENCE_END = (
    _AFTER_WORD
    + r"[ \t]*(?:"
    + STOP
    + r"|👤|#)|[ \t]+"
    + _BLOCK_ID
    + r"|[ \t]*\n|[ \t]*$"
    + _AT_CUT
)
ID = re.compile("🆔" + _VS + _ONE_WORD)
"""The id field `🆔 kt-…`: a `🆔` whose next word is no marker."""
RECURRENCE = re.compile("🔁" + _VS + r"[ \t]+(.+?)" + _RECURRENCE_END)
BLOCK_ID = re.compile(r"(?:^|(?<![ \t])[ \t]+)\^[A-Za-z0-9_-]+$")
"""A trailing block id, as the editor's `withoutBlockId` takes it. `[\\w-]` there is ASCII.

The lookbehind starts the gap at its first blank only, so a long run of blanks is linear."""
FIELDS = (
    re.compile("(?:📅|📆|🗓)" + _VS + _DATE),
    re.compile("⏳" + _VS + _DATE),
    re.compile("🛫" + _VS + _DATE),
    re.compile("(🔺|⏫|🔼|🔽|⏬)" + _VS),
    RECURRENCE,
    re.compile("🏁" + _VS + r"[ \t]+(keep|delete)(?=[ \t\n]|$)"),
    re.compile(_CREATED + _VS + _DATE),
    DONE,
    re.compile("❌" + _VS + _DATE),
    re.compile("⏲" + _VS + _ONE_WORD),
    re.compile("⏱" + _VS + _ONE_WORD),
    ID,
)
BLOCKED_BY = re.compile("⛔" + _VS + _ONE_WORD)
# What a cut field leaves behind: a stop for every free-text or one-word value, so
# it does not run across the gap. `_WORD` and the `🔁` value already refuse it.
_CUT = "\n"
# A `👤` value ends at a field, tag, block id, `👤` or cut; a wait's name is optional.
_ENDS = (
    _AFTER_WORD + r"[ \t]+(?:" + STOP + r"|🔁|👤|#|" + _BLOCK_ID + r")|[ \t]*\n|[ \t]*$" + _AT_CUT
)
WAITING = re.compile("👤" + _VS + _DATE + r"(?:[ \t]+(.+?))??" + _ENDS)
# The assignee: a `👤` whose value is no date, marker or block id. The
# `(?![ \t])` stops a backtrack from leaving a space to start the value.
ASSIGNEE = re.compile(
    "👤"
    + _VS
    + r"[ \t]+(?![ \t])(?!"
    + r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[ \t]|$)|"
    + STOP
    + r"|🔁|👤|#|"
    + _BLOCK_ID
    + r")(.+?)"
    + _ENDS
)

SPANS = re.compile(
    r"\[\[[^\[\]\n]+\]\]|\[[^\[\]\n]*\]\([^\[)\n]*\)|`[^`\n]*`|<!--[^>\n](?:-?[^-\n])*?-->"
)
"""A link, a markdown link, a code span and an HTML comment closed on its line, not on `<!-->`.

A comment holds no `--`, as in the editor (#1474). A marker inside one is no field, nor a tag.
A markdown link holds no `[`, so a long line of brackets reads in linear time.
No lookaround, since rg runs it too. The editor's copy is in `tag-rule.ts`.
"""


def blank(text: str, spans: re.Pattern[str]) -> str:
    """`text` with every match of `spans` blanked to no-break spaces, offsets kept."""
    return spans.sub(lambda span: re.sub(r"[^ \t]", "\N{NO-BREAK SPACE}", span[0]), text)


def mask(text: str) -> str:
    """`text` with every span blanked to no-break spaces, its offsets kept.

    Public so completion offers only tags the board and the editor would read.
    """
    return blank(text, SPANS)


def _scan(
    rest: str,
) -> tuple[str, str | None, dict[re.Pattern[str], tuple[int, int]], list[tuple[int, int]]]:
    """A todo's words, assignee and the place of each field, as `readTagged` reads them.

    Fields are found on a copy with every span blanked, so a marker in a link is no marker.
    Each cut leaves `_CUT` behind, so a value read after it stops there. Only the first
    match of each pattern is tried, as in the editor, except `⛔`, which repeats.
    """
    text = rest
    masked = mask(rest)
    # Where each character of `text` sits in `rest`, -1 for a cut: the span the
    # assignee takes is then the reader's own cut, not a match on the whole line.
    origin = list(range(len(rest)))
    who = None
    places = {}
    cuts = []
    for pattern in (*FIELDS, BLOCKED_BY, WAITING, ASSIGNEE):
        while (found := pattern.search(masked)) is not None and any(found.groups()):
            if pattern is ASSIGNEE:
                who = text[found.start(1) : found.end(1)]
            cuts.append((origin[found.start()], origin[found.end() - 1] + 1))
            places.setdefault(pattern, cuts[-1])
            text = text[: found.start()] + _CUT + text[found.end() :]
            masked = masked[: found.start()] + _CUT + masked[found.end() :]
            origin = [*origin[: found.start()], -1, *origin[found.end() :]]
            if pattern is not BLOCKED_BY:
                break
    # As the editor squeezes the words, so `[[FDE  Kickoff]]` names `FDE Kickoff`.
    return re.sub(r"[ \t]+", " ", text.replace(_CUT, "")), who, places, sorted(cuts)


def words(rest: str) -> str:
    """A todo's words, as `_scan` leaves them."""
    return _scan(rest)[0]


def field_spans(rest: str) -> list[tuple[int, int]]:
    """Where every field the reader cuts sits in `rest`, in line order: all but the words."""
    return _scan(rest)[3]


def assignee(rest: str) -> str | None:
    """The assignee a todo's words name, as written, or None when no undated `👤` names one."""
    return _scan(rest)[1]


def assignee_span(rest: str) -> tuple[int, int] | None:
    """Where the assignee's `👤` and value sit in `rest`, as the reader cuts them, or None.

    The span ends where the cut ends the value, so a field glued to it (`👤 [[Alicia]]📅 …`)
    is not part of it.
    """
    return place(rest, ASSIGNEE)


def place(rest: str, field: re.Pattern[str]) -> tuple[int, int] | None:
    """Where the reader takes `field` in `rest`, the first one for `BLOCKED_BY`, or None."""
    return _scan(rest)[2].get(field)


def id_of(rest: str) -> str | None:
    """The id the reader takes off a todo's words, without its `🆔`, or None."""
    found = place(rest, ID)
    match = None if found is None else ID.match(rest, *found)
    return None if match is None else match[1]
