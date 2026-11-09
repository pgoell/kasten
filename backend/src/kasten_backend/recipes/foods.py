"""Foods of your own, read from `99 Misc/01 Config/foods.md` as `my-foods.ts` reads them.

The grammar is in `docs/reference/food/log-format.md#the-foods-note`; both readers run
`backend/tests/food/foods_cases.json`.
"""

import re
from dataclasses import dataclass

from kasten_backend import log
from kasten_backend.frontmatter import closing

FOODS_NOTE = "foods.md"
NUMBER = r"[0-9]{1,9}(?:[.,][0-9]{1,9})?"
LINE = re.compile(
    rf"- (.+?):[ \t]+(?:({NUMBER})[ \t]*g,[ \t]+)?(?:🏷️?[ \t]+([0-9]{{8,14}}),[ \t]+)?([🔥🥩🍞🧈].*)"
)
"""The name is lazy and the rest anchored, as in `my-foods.ts`, so a colon in a name is passed."""


@dataclass(frozen=True)
class MyFood:
    """One food of your own: its serving, if the line names one, barcode, and figures per 100 g."""

    name: str
    serving_g: float | None
    code: str | None
    kcal: float | None
    protein: float | None
    carbs: float | None
    fat: float | None


def parse_my_food(line: str) -> MyFood | None:
    """The food a line names, or None for a line that does not read as one."""
    found = LINE.fullmatch(line)
    if found is None:
        return None
    name = found[1].strip()
    serving = None if found[2] is None else float(found[2].replace(",", "."))
    # The fields read as a food line's fields, so the two formats cannot drift apart.
    fields = log.parse_line(f"- 🍽 x {found[4]}", 1)
    if not name or serving == 0 or fields is None or fields.words != "x":
        return None
    return MyFood(
        name=name,
        serving_g=serving,
        code=found[3],
        kcal=fields.kcal,
        protein=fields.protein,
        carbs=fields.carbs,
        fat=fields.fat,
    )


def parse_my_foods(note: str) -> list[MyFood]:
    """The foods a note names, below its frontmatter. A line that names none is passed over."""
    lines = note.split("\n")
    close = closing(lines)
    start = 0 if close is None else close + 1
    return [
        food
        for text in lines[start:]
        if text.startswith("- ") and (food := parse_my_food(text.rstrip("\r"))) is not None
    ]
