"""The amount and unit at the start of a German ingredient line, read by rule.

No German parser exists to borrow, and a model tags ingredients badly, so the rules are here and
their cases are `backend/tests/food/ingredient_cases.json`. The raw line stays the truth.
"""

import re
from dataclasses import dataclass

VULGAR = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125}
NUMBER = r"[0-9]+(?:[.,][0-9]+)?"
QUANTITY = re.compile(
    rf"(?P<whole>{NUMBER})?[ \t]*(?:(?P<over>[0-9]+)/(?P<under>[0-9]+)|(?P<vulgar>[½¼¾⅓⅔⅛]))"
    rf"|(?P<number>{NUMBER})"
)
"""A number, a fraction (`1/2`, `½`) or a whole number and a fraction (`1 1/2`, `1½`)."""
RANGE = re.compile(r"[ \t]*(?:-|\u2013|bis[ \t])[ \t]*(?:[0-9]+(?:[.,/][0-9]+)?|[½¼¾⅓⅔⅛])")
"""The upper end of a range, `2-3` or `2 bis 3`, which is passed over: the lower end counts."""
WORDS = {"ein": 1.0, "eine": 1.0, "einen": 1.0, "einer": 1.0, "zwei": 2.0, "drei": 3.0}
NO_AMOUNT = re.compile(
    r"(?:etwas|ein[ \t]+wenig|wenig|n\.[ \t]*b\.|nach[ \t]+(?:belieben|geschmack))(?!\w)[ \t]*",
    re.IGNORECASE,
)
"""Words that stand where an amount would and say there is none."""

UNITS: dict[str, tuple[str, float | None]] = {}
"""Each spelling of a unit, lowercase, with the unit's name and grams per one, None for a count."""
for name, grams, spellings in (
    ("g", 1.0, "g gr gramm"),
    ("kg", 1000.0, "kg kilo kilogramm"),
    ("mg", 0.001, "mg"),
    ("ml", 1.0, "ml milliliter"),
    ("cl", 10.0, "cl"),
    ("dl", 100.0, "dl"),
    ("l", 1000.0, "l liter"),
    ("EL", 15.0, "el essl esslöffel"),
    ("TL", 5.0, "tl teel teelöffel"),
    ("Prise", 0.5, "prise prisen prise(n)"),
    ("Msp", 0.25, "msp messerspitze messerspitzen"),
    ("Stück", None, "stück stk st"),
    ("Dose", None, "dose dosen dose(n)"),
    ("Packung", None, "pck pkg päckchen packung packungen"),
    ("Bund", None, "bund"),
    ("Zehe", None, "zehe zehen zehe(n)"),
    ("Scheibe", None, "scheibe scheiben scheibe(n)"),
    ("Becher", None, "becher"),
    ("Glas", None, "glas gläser"),
    ("Tasse", None, "tasse tassen"),
    ("Handvoll", None, "handvoll"),
):
    for spelling in spellings.split():
        UNITS[spelling] = (name, grams)

UNIT = re.compile(
    r"(?P<unit>"
    + "|".join(re.escape(s) for s in sorted(UNITS, key=len, reverse=True))
    + r")\.?(?=[ \t,]|$)",
    re.IGNORECASE,
)
EACH = re.compile(rf"\((?:ca\.?[ \t]*|je[ \t]+|à[ \t]*)?({NUMBER})[ \t]*(g|ml)\)", re.IGNORECASE)
"""A weight in brackets, `(400 g)` or `(je 400 g)`, which says what one of a counted unit weighs."""


@dataclass(frozen=True)
class Amount:
    """What an ingredient line says about how much: a quantity, a unit, and the rest of the line."""

    quantity: float | None
    """None where the line gives no amount, as `etwas Salz` or `Salz`."""
    unit: str | None
    grams_per_unit: float | None
    """Grams in one unit, from the unit or a bracketed weight. None for a count with neither."""
    food: str
    """The words that name the food: up to the first comma, brackets left out."""
    note: str | None
    """What follows the first comma, as `abgetropft`."""
    rest: str
    """The line after its quantity, unit included, so a view can scale the number alone."""


def _number(text: str) -> float:
    return float(text.replace(",", "."))


def _quantity(text: str) -> tuple[float | None, str]:
    """The quantity at the start of `text`, and what follows it."""
    found = QUANTITY.match(text)
    if found is None:
        word, _, rest = text.partition(" ")
        if word.lower() in WORDS:
            return WORDS[word.lower()], rest
        return None, text
    if found["number"] is not None:
        value = _number(found["number"])
    else:
        part = (
            VULGAR[found["vulgar"]]
            if found["vulgar"] is not None
            else int(found["over"]) / max(int(found["under"]), 1)
        )
        value = (_number(found["whole"]) if found["whole"] is not None else 0) + part
    rest = text[found.end() :]
    if over := RANGE.match(rest):
        rest = rest[over.end() :]
    return value, rest


def parse_amount(text: str) -> Amount:
    """What the ingredient line `text`, its bullet taken off, says about its amount and food."""
    text = text.strip()
    whole = text
    quantity: float | None = None
    unit: str | None = None
    grams: float | None = None
    if (none := NO_AMOUNT.match(text)) is not None:
        text = text[none.end() :]
    else:
        quantity, text = _quantity(text)
        text = text.lstrip()
        whole = text if quantity is not None else whole
        if quantity is not None and (found := UNIT.match(text)) is not None:
            unit, grams = UNITS[found["unit"].lower()]
            text = text[found.end() :].lstrip()
    if grams is None and quantity is not None and (each := EACH.search(text)) is not None:
        grams = _number(each[1])
    words, _, note = text.partition(",")
    food = re.sub(r"\([^)]*\)", " ", words)
    return Amount(
        quantity=quantity,
        unit=unit,
        grams_per_unit=grams,
        food=" ".join(food.split()),
        note=note.strip() or None,
        rest=whole,
    )
