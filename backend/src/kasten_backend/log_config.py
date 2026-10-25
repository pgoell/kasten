"""The log config note, `99 Misc/01 Config/log.md`, read the way the card reads it.

The note names the kinds of your own and their daily goals. The grammar is in
`docs/reference/log-format.md`, and its cases are `frontend/src/lib/log-config-cases.json`,
which the frontend and backend tests both run. `frontend/src/lib/log-kinds.ts` is the
other reader, so a rule changed here changes there too.
"""

import re
import unicodedata
from dataclasses import dataclass

NUMBER = r"[0-9]{1,9}(?:[.,][0-9]{1,9})?"
"""One to nine digits, then an optional point or comma and one to nine more.

Capped so a value is one a float holds exactly, the same cap the log lines carry.
"""

BUILTINS = {"💧": "water", "☕": "coffee", "🍺": "alcohol"}
"""The marks of the built-in kinds, each with the kind it stands for."""

FIELD_MARKS = frozenset({"🔥", "🥩", "🍞", "🧈"})
"""The food line's field markers. A kind on one would read as a field inside a food line."""

KIND_LINE = re.compile(
    rf"- (?P<mark>.)️?[ \t]+(?P<name>[^:]+):[ \t]*"
    rf"(?:(?P<tap>{NUMBER})(?:[ \t]+(?P<unit>[A-Za-z]+))?"
    rf"|(?:(?!last\b)(?P<last_unit>[A-Za-z]+)[ \t]*,[ \t]*)?(?P<last>last))"
    rf"(?:[ \t]*,[ \t]*(?P<sense>min|max)[ \t]+(?P<goal>{NUMBER}))?[ \t]*",
    re.IGNORECASE,
)
"""A kind line: the mark, the name up to the colon, then a tap or `last`, and an optional goal.

A tap takes an optional unit. `last` takes an optional unit too, and the lookahead keeps
the word itself from reading as one. The mark is any one character, and `parse_kind_config`
asks whether it is a symbol. A character class of symbols cannot be written here, since
`re` has no Unicode categories.
"""

FOOD_LINE = re.compile(r"- 🍽️?[ \t]+([^:]+):(.*)")
"""A food line: its marker, its name up to the colon, then the goals."""

FOOD_GOAL = re.compile(
    rf"[ \t]*(kcal|protein|carbs|fat)[ \t]+(min|max)[ \t]+({NUMBER})[ \t]*", re.IGNORECASE
)
"""One goal of a food line: a field, `min` or `max`, and its number."""


@dataclass(frozen=True)
class Goal:
    """A daily floor (`min`) or ceiling (`max`)."""

    type: str
    value: float


@dataclass(frozen=True)
class Kind:
    """One kind the note names: its mark, name, what one tap logs and its goal, if any.

    A last kind has no tap and `last` True: its day's value is its last line, not a sum.
    """

    mark: str
    name: str
    tap: float | None
    unit: str
    goal: Goal | None = None
    builtin: str | None = None
    last: bool | None = None


@dataclass(frozen=True)
class Config:
    """What the note gives: its kinds, its food goals, and each line it could not read."""

    kinds: list[Kind]
    food: dict[str, Goal]
    broken: list[tuple[int, str]]


DEFAULT_CONFIG = Config(
    kinds=[
        Kind("💧", "water", 250, "ml", builtin="water"),
        Kind("☕", "coffee", 1, "", builtin="coffee"),
        Kind("🍺", "alcohol", 1, "", builtin="alcohol"),
    ],
    food={},
    broken=[],
)
"""What a missing note gives: the three kinds the card had before the note existed."""


def _amount(text: str) -> float:
    """A written number as a float, a comma read as the point."""
    return float(text.replace(",", "."))


def _clean(value: float) -> float:
    """A product with the float noise cut: 1.1 litres is 1100 ml, not 1100.0000000000002."""
    return float(f"{value:.15g}")


def parse_food_line(text: str) -> dict[str, Goal] | None:
    """A food line's goals, or None where it names no field, repeats one or gives a bad value.

    A value no parser reads, or a goal of zero or less, makes the whole line broken.
    """
    head = FOOD_LINE.fullmatch(text)
    if head is None or head[1].strip() == "":
        return None
    goals: dict[str, Goal] = {}
    for piece in head[2].split(","):
        goal = FOOD_GOAL.fullmatch(piece)
        if goal is None:
            return None
        field = goal[1].lower()
        value = _amount(goal[3])
        if field in goals or value <= 0:
            return None
        goals[field] = Goal("floor" if goal[2].lower() == "min" else "ceiling", value)
    return goals


def _is_mark(character: str) -> bool:
    """Whether a kind's mark is a symbol, which is what an emoji is and a letter or digit is not."""
    return unicodedata.category(character) == "So"


def parse_kind_config(text: str) -> Kind | None:
    """A kind line as its kind, or None where the line is broken.

    The caller checks the mark is free, since only the note as a whole knows the other marks.
    """
    found = KIND_LINE.fullmatch(text)
    if found is None:
        return None
    mark, label = found["mark"], found["name"].strip()
    written = found["unit"] or found["last_unit"] or ""
    builtin = BUILTINS.get(mark)
    last = found["last"] is not None
    # A built-in kind keeps its tap, so `last` is broken on one.
    if not _is_mark(mark) or label == "" or mark in FIELD_MARKS or (last and builtin):
        return None
    tap = None
    if not last:
        tap_text = found["tap"]
        tap = _amount(tap_text)
        # Coffee and alcohol are counted, so a tap is a whole number with no unit.
        counted = builtin in ("coffee", "alcohol")
        whole = re.fullmatch("[0-9]+", tap_text) is not None
        wrong_unit = (builtin == "water" and written.lower() not in ("ml", "l")) or (
            counted and (written != "" or not whole)
        )
        if tap <= 0 or wrong_unit:
            return None
    goal = None
    if found["sense"] is not None:
        goal_value = _amount(found["goal"])
        if goal_value <= 0:
            return None
        # The day's water is counted in millilitres, so a goal in litres is scaled to match.
        scale = 1000 if builtin == "water" and written.lower() == "l" else 1
        sense = found["sense"].lower()
        goal = Goal("floor" if sense == "min" else "ceiling", _clean(goal_value * scale))
    return Kind(mark, label, tap, written, goal, builtin, last or None)


def parse_config(note: str | None) -> Config:
    """The config a note gives, its kinds and food goals and the lines it could not read.

    A missing note gives the defaults. Any other note gives exactly the kinds its valid
    lines name, and lists the rest as broken.
    """
    if note is None:
        return DEFAULT_CONFIG
    lines = note.split("\n")
    # The frontmatter runs from a first `---` to the next one, and holds no config.
    close = -1
    if lines[0] == "---" and "---" in lines[1:]:
        close = lines.index("---", 1)
    kinds: list[Kind] = []
    broken: list[tuple[int, str]] = []
    marks: set[str] = set()
    food: dict[str, Goal] | None = None
    for index, text in enumerate(lines):
        if index <= close or not text.startswith("- "):
            continue
        number = index + 1
        # Only the first food line that reads counts, so a second one is broken.
        if text.startswith("- 🍽"):
            goals = parse_food_line(text)
            if goals is None or food is not None:
                broken.append((number, text))
            else:
                food = goals
            continue
        kind = parse_kind_config(text)
        # The first line keeps a mark, so a later line with the same mark is broken.
        if kind is None or kind.mark in marks:
            broken.append((number, text))
            continue
        marks.add(kind.mark)
        kinds.append(kind)
    return Config(kinds, food if food is not None else {}, broken)


def parse_kind_line(kind: Kind, line: str) -> float | None:
    """The amount a log line holds for a kind of your own, or None.

    `- <mark> <NUMBER>[ <unit>]` as the whole line, with the unit required and matched
    case-insensitively iff the kind has one.
    """
    found = re.fullmatch(
        rf"- {re.escape(kind.mark)}️?[ \t]+({NUMBER})(?:[ \t]+([A-Za-z]+))?[ \t]*", line
    )
    if found is None:
        return None
    written = found[2] or ""
    if written.lower() != kind.unit.lower():
        return None
    value = _amount(found[1])
    return value if value > 0 else None
