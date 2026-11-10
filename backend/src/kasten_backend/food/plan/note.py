"""A week plan note's meals, read line by line: who cooks what, and what comes from a batch.

The format is in `docs/reference/food/meal-plan.md`.
"""

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from kasten_backend import frontmatter

Slot = Literal["lunch", "dinner"]
Kind = Literal["cook", "from", "other"]

DAYS = ("mo", "di", "mi", "do", "fr", "sa", "so")
DAY = r"(?P<day>mo|di|mi|do|fr|sa|so)[a-zäöüß]*\.?"
SLOTS: dict[str, Slot] = {
    "lunch": "lunch",
    "mittag": "lunch",
    "mittags": "lunch",
    "mittagessen": "lunch",
    "dinner": "dinner",
    "abend": "dinner",
    "abends": "dinner",
    "abendessen": "dinner",
}
MEAL = re.compile(
    rf"[-*+] (?:\[[ xX]\] )?{DAY}[ \t]+(?P<slot>{'|'.join(SLOTS)})[ \t]*:[ \t]*(?P<rest>.*?)[ \t]*",
    re.IGNORECASE,
)
TRAINING = re.compile(rf"[-*+] {DAY}:?[ \t]+(?:🏋️?|training)[ \t]*", re.IGNORECASE)
LINK = r"\[\[(?P<target>[^\]|#]+)(?:[^\]]*)\]\]"
COOK = re.compile(
    rf"(?:cook|kochen|koch)[ \t]+{LINK}(?:[ \t]*[x\u00d7][ \t]*(?P<servings>[0-9]{{1,3}}))?",
    re.IGNORECASE,
)
FROM = re.compile(rf"(?:from|aus|von)[ \t]+{LINK}", re.IGNORECASE)
ANY_LINK = re.compile(LINK)
COOK_NAME = re.compile(r"👤[ \t]*(?:\[\[([^\]|#]+)[^\]]*\]\]|(\S+))")
WEEK = re.compile(r"([0-9]{4})-?W([0-9]{1,2})", re.IGNORECASE)
FRIDGE_DAYS = 2
"""A batch's meal this many days after cooking is on its third day in the fridge, and warns."""


@dataclass(frozen=True)
class Meal:
    """One planned meal: its day (0 for Monday), slot, kind, and the recipe it names."""

    line: int
    day: int
    slot: Slot
    kind: Kind
    text: str
    """The line after its `Mo dinner:`, as written."""
    target: str | None
    """The recipe link's name, without alias or heading, or None for a meal with no link."""
    servings: int | None = None
    cook: str | None = None


@dataclass
class Plan:
    """What the note gives: its week, the fridge limit, the meals and the marked training days."""

    monday: date | None
    fridge_days: int
    meals: list[Meal] = field(default_factory=list)
    training: set[int] = field(default_factory=set)


def _monday(text: str | None) -> date | None:
    found = WEEK.fullmatch((text or "").strip())
    if found is None:
        return None
    try:
        return date.fromisocalendar(int(found[1]), int(found[2]), 1)
    except ValueError:
        return None


def _fridge(text: str | None) -> int:
    try:
        days = int((text or "").split()[0])
    except ValueError, IndexError:
        return FRIDGE_DAYS
    return days if days > 0 else FRIDGE_DAYS


def _meal(line: int, day: int, slot: Slot, rest: str) -> Meal:
    name = COOK_NAME.search(rest)
    cook = None if name is None else (name[1] or name[2]).strip()
    if (made := COOK.match(rest)) is not None:
        servings = int(made["servings"]) if made["servings"] else None
        target = made["target"].strip()
        return Meal(line, day, slot, "cook", rest, target, servings or None, cook)
    if (drawn := FROM.match(rest)) is not None:
        return Meal(line, day, slot, "from", rest, drawn["target"].strip())
    link = ANY_LINK.search(rest)
    target = None if link is None else link["target"].strip()
    return Meal(line, day, slot, "other", rest, target, cook=cook)


def parse_plan(content: str) -> Plan:
    """The plan the note `content` holds. Lines that name no day and slot are passed over."""
    plan = Plan(
        monday=_monday(frontmatter.field(content, "week")),
        fridge_days=_fridge(frontmatter.field(content, "fridge")),
    )
    lines = content.split("\n")
    close = frontmatter.closing(lines)
    for index, raw in enumerate(lines):
        text = raw.rstrip("\r")
        if close is not None and index <= close:
            continue
        if (found := MEAL.fullmatch(text)) is not None:
            day = DAYS.index(found["day"].lower())
            slot = SLOTS[found["slot"].lower()]
            plan.meals.append(_meal(index + 1, day, slot, found["rest"]))
        elif (marked := TRAINING.fullmatch(text)) is not None:
            plan.training.add(DAYS.index(marked["day"].lower()))
    return plan
