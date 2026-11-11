"""The week plans' meals as the lists app's Essen tab shows them: by day, from today on.

Read-only, and only meals: training days and protein stay in kasten.
"""

import re
from datetime import date, timedelta
from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend import frontmatter, vault
from kasten_backend.food.plan.note import (
    Kind,
    Slot,
    parse_plan,
)

if TYPE_CHECKING:
    from pathlib import Path

DAYS_SHOWN = 7
# No part holds a `[` or the mark opening the next, and a gap starts on its first blank only,
# so a long line reads in linear time.
LINK = re.compile(r"\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|([^\[\]]+))?\]\]")
COOK = re.compile(r"(?<![ \t])[ \t]*👤.*$")


class SharedMeal(BaseModel):
    """One meal: the dish, whether it comes from a batch, how many it cooks, and who cooks."""

    slot: Slot
    kind: Kind
    dish: str
    servings: int | None
    cook: str | None


class SharedDay(BaseModel):
    """A day that has a planned meal, its meals lunch first."""

    date: str
    meals: list[SharedMeal]


def _words(text: str) -> str:
    """A meal's words without link brackets or its cook, `[[Dal|Linsen-Dal]]` as `Linsen-Dal`."""
    plain = LINK.sub(lambda found: (found[2] or found[1]).strip(), COOK.sub("", text))
    return " ".join(plain.split())


def upcoming(root: Path, folder: str, names: list[str], today: date) -> list[SharedDay]:
    """The meals of each week plan among the share folder's `names`, today and six days on.

    Blocking file reads, so an async caller runs it in a thread.
    """
    last = today + timedelta(DAYS_SHOWN - 1)
    found: dict[str, list[tuple[int, SharedMeal]]] = {}
    for name in names:
        try:
            text = vault.read_note(root, f"{folder}/{name}.md")
        except UnicodeDecodeError, OSError:
            continue
        kind = (frontmatter.field(text or "", "type") or "").strip("'\"").lower()
        if text is None or kind != "meal plan":
            continue
        plan = parse_plan(text)
        if plan.monday is None:
            continue
        for meal in plan.meals:
            day = plan.monday + timedelta(meal.day)
            if not today <= day <= last:
                continue
            dish = meal.target if meal.kind in ("cook", "from") and meal.target else None
            shown = SharedMeal(
                slot=meal.slot,
                kind=meal.kind,
                dish=dish or _words(meal.text),
                servings=meal.servings,
                cook=meal.cook,
            )
            found.setdefault(day.isoformat(), []).append((0 if meal.slot == "lunch" else 1, shown))
    return [
        SharedDay(date=day, meals=[meal for _, meal in sorted(meals, key=lambda pair: pair[0])])
        for day, meals in sorted(found.items())
    ]
