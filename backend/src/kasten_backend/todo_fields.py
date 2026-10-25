"""The field readers of a todo line: the markers its words carry, and the words and assignee left.

Its own module because these are a port of the editor's `readFields` in
`todo-fields.ts`, held to it by one table of cases. They need no vault, so they
import nothing from `todos.py`, which reads them.
"""

import re

# The fields `readFields` in the editor's `todo.ts` takes off a todo's words,
# spelled the same and taken in the same order, because one taken first can
# change where a free-text one ends. A link inside a field's value is no link
# the todo is filed by, the words being only what is left. Each marker may
# carry the variation selector. `[0-9]` and the spelled-out `\^` class because
# the editor's `\d` and `\w` are ASCII and Python's are not.
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
# A one-word value never starts with a field marker, so a bare `⏲` before `🆔 kt-1`
# reads the `🆔` as the next field. `👤` is left out on purpose: `⏲ 👤 2026-10-20`
# reads `👤` as the estimate, as the editor does.
_ONE_WORD = r"[ \t]+(?!(?:" + STOP + r"|🔁))" + _WORD
_DATE = r"[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})"
_BLOCK_ID = r"\^[A-Za-z0-9_-]+[ \t]*(?:\n|$)"
# A `🔁` value runs to the next field, tag, `👤`, block id or cut, as the editor's does.
_RECURRENCE_END = r"(?=[ \t]*(?:" + STOP + r"|👤|#)|[ \t]+" + _BLOCK_ID + r"|[ \t]*\n|[ \t]*$)"
FIELDS = (
    re.compile("(?:📅|📆|🗓)" + _VS + _DATE),
    re.compile("⏳" + _VS + _DATE),
    re.compile("🛫" + _VS + _DATE),
    re.compile("(🔺|⏫|🔼|🔽|⏬)" + _VS),
    re.compile("🔁" + _VS + r"[ \t]+(.+?)" + _RECURRENCE_END),
    re.compile("🏁" + _VS + r"[ \t]+(keep|delete)(?=[ \t\n]|$)"),
    re.compile(_CREATED + _VS + _DATE),
    re.compile("✅" + _VS + _DATE),
    re.compile("❌" + _VS + _DATE),
    re.compile("⏲" + _VS + _ONE_WORD),
    re.compile("⏱" + _VS + _ONE_WORD),
    re.compile("🆔" + _VS + _ONE_WORD),
)
BLOCKED_BY = re.compile("⛔" + _VS + _ONE_WORD)
# What a cut field leaves behind: a stop for every free-text or one-word value, so
# it does not run across the gap. `_WORD` and the `🔁` value already refuse it.
_CUT = "\n"
# A `👤` value ends at a field, tag, block id, `👤` or cut; a wait's name is optional.
_ENDS = r"(?=[ \t]+(?:" + STOP + r"|🔁|👤|#|" + _BLOCK_ID + r")|[ \t]*\n|[ \t]*$)"
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

SPANS = re.compile(r"\[\[[^\[\]\n]+\]\]|\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]*`|<!--[^\n]*?-->")
"""A link, a markdown link, a code span and an HTML comment closed on its line.

A marker inside one is not a field, nor a tag. The editor's `SPANS` in
`tag-rule.ts` is the same pattern, and rg reads it too, through `tags.py`.
"""


def blank(text: str, spans: re.Pattern[str]) -> str:
    """`text` with every one of `spans` blanked to no-break spaces, its spaces and offsets kept."""
    return spans.sub(lambda span: re.sub(r"[^ \t]", "\N{NO-BREAK SPACE}", span[0]), text)


def mask(text: str) -> str:
    """`text` with every span blanked to no-break spaces, its spaces and offsets kept.

    Public because `tags.py` reads the tag vocabulary through it too, so that
    completion offers no tag the board and the editor would not read as one.
    """
    return blank(text, SPANS)


def _fields(rest: str) -> tuple[str, str | None]:
    """A todo's words and its assignee: the words with every field out, as `readFields` leaves them.

    Each field is found on a copy with every span blanked to a no-break space,
    so a marker inside a link is no marker and a one-word value cannot run into
    one, and cut from both. Each cut leaves `_CUT` where it stood, so a value
    read after it stops there. A match with no value is no field, and only the
    first match of each is tried, as in the editor; only `⛔` repeats. The
    assignee is read off `rest`, so its spelling is kept.
    """
    text = rest
    masked = mask(rest)
    who = None
    for pattern in (*FIELDS, BLOCKED_BY, WAITING, ASSIGNEE):
        while (found := pattern.search(masked)) is not None and any(found.groups()):
            if pattern is ASSIGNEE:
                who = text[found.start(1) : found.end(1)]
            text = text[: found.start()] + _CUT + text[found.end() :]
            masked = masked[: found.start()] + _CUT + masked[found.end() :]
            if pattern is not BLOCKED_BY:
                break
    # As the editor squeezes the words, so `[[FDE  Kickoff]]` names `FDE Kickoff`.
    return re.sub(r"[ \t]+", " ", text.replace(_CUT, "")), who


def words(rest: str) -> str:
    """A todo's words, as `_fields` leaves them."""
    return _fields(rest)[0]


def assignee(rest: str) -> str | None:
    """The assignee a todo's words name, as written, or None when no undated `👤` names one."""
    return _fields(rest)[1]
