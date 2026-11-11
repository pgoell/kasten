"""A week's cooked batches as shopping lines, merged into the shared shopping list.

Scaled to servings, merged only where food and unit match an open line, never over a ticked
one, filed under an aisle heading, each line linking back to its recipes.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from kasten_backend import todo_fields
from kasten_backend.food.recipes import parse_amount
from kasten_backend.food.recipes.note import RecipeNote  # noqa: TC001  read at runtime

_AISLES = json.loads((Path(__file__).parent / "aisles.json").read_text(encoding="utf-8"))
ORDER: list[str] = _AISLES["order"]
BY_UNIT: dict[str, str] = _AISLES["units"]
WORDS = sorted(
    ((word, aisle) for aisle, words in _AISLES["words"].items() for word in words),
    key=lambda pair: -len(pair[0]),
)
"""Each word with its aisle, longest first, so `kokosmilch` wins over `milch`."""
OTHER = ORDER[-1]
PIN = re.compile(r"[ \t]*🏷️?[ \t]*[0-9]{8,14}\b")
OPEN = re.compile(r"- \[ \] (.*?)(\r?)")
LINKS = re.compile(r"[ \t]*\((\[\[[^\]]+\]\](?:,[ \t]*\[\[[^\]]+\]\])*)\)")
NAME = re.compile(r"\[\[([^\]|#]+)[^\]]*\]\]")
HEADING = re.compile(r"#{1,6} (.+?)[ \t]*\r?")
SHORT = 2
"""A word this short, such as `ei`, names a food only when it is the whole name."""


@dataclass
class Need:
    """One food in one unit the week needs, with each recipe's share of the quantity."""

    food: str
    unit: str | None
    words: str
    """The line after its quantity, its note left out, as `Dosen Tomaten (je 400 g)`."""
    shares: dict[str, float | None] = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, str | None]:
        """What two lines must share to merge: the food, folded to lowercase, and the unit."""
        return _key(self.food, self.unit)

    def quantity(self, recipes: list[str]) -> float | None:
        """The quantity `recipes` need together, or None when none of them names one."""
        known = [q for name, q in self.shares.items() if name in recipes and q is not None]
        return sum(known) if known else None


def _key(food: str, unit: str | None) -> tuple[str, str | None]:
    return " ".join(food.lower().split()), unit


def aisle(need: Need) -> str:
    """The aisle a food sits in: by its unit for a tin or a jar, else by the words of its name."""
    if need.unit in BY_UNIT:
        return BY_UNIT[need.unit]
    name = need.key[0]
    for word, found in WORDS:
        if (word == name) if len(word) <= SHORT else (word in name):
            return found
    return OTHER


def needs(cooked: list[tuple[str, RecipeNote, int | None]]) -> list[Need]:
    """Every food the cooked batches need, as (recipe link, recipe, servings), in recipe order.

    A batch with no servings, or a recipe that names none, is bought as the note says.
    """
    found: dict[tuple[str, str | None], Need] = {}
    for name, recipe, servings in cooked:
        factor = servings / recipe.servings if servings and recipe.servings else 1.0
        for line in recipe.ingredients:
            amount = parse_amount(PIN.sub("", line.text))
            if not amount.food:
                continue
            words = amount.rest.split(",", 1)[0].strip() if amount.note else amount.rest
            need = found.setdefault(
                _key(amount.food, amount.unit), Need(amount.food, amount.unit, words)
            )
            share = None if amount.quantity is None else amount.quantity * factor
            before = need.shares.get(name)
            need.shares[name] = share if before is None else before + (share or 0)
    return list(found.values())


def shown(quantity: float) -> str:
    """A quantity as a German list writes it: whole from 10 up, else to two places, a comma."""
    value = round(quantity) if quantity >= 10 else round(quantity, 2)  # noqa: PLR2004
    return f"{value:g}".replace(".", ",")


def _links(names: list[str]) -> str:
    return " (" + ", ".join(f"[[{name}]]" for name in names) + ")"


@dataclass
class Merged:
    """What a merge did: lines added, open lines that took more, needs already on the list."""

    text: str
    added: int = 0
    merged: int = 0
    skipped: int = 0


def _open_lines(lines: list[str]) -> dict[tuple[str, str | None], int]:
    """Each open top-level line by the food and unit it names, the first one winning."""
    found: dict[tuple[str, str | None], int] = {}
    for number, line in enumerate(lines):
        if (item := OPEN.fullmatch(line)) is None:
            continue
        rest = LINKS.sub("", item[1])
        amount = parse_amount(todo_fields.words(rest).strip())
        if amount.food:
            found.setdefault(_key(amount.food, amount.unit), number)
    return found


def _topped(line: str, need: Need) -> tuple[str, bool]:
    """The open `line` with the recipes it does not link yet added in, or unchanged."""
    item = OPEN.fullmatch(line)
    if item is None:
        return line, False
    rest, ending = item[1], item[2]
    group = LINKS.search(rest)
    linked = [] if group is None else NAME.findall(group[1])
    lower = {name.strip().lower() for name in linked}
    new = [name for name in need.shares if name.lower() not in lower]
    if not new:
        return line, False
    adding = need.quantity(new)
    body = rest if group is None else rest[: group.start()] + rest[group.end() :]
    amount = parse_amount(body)
    if adding is not None:
        total = adding + (amount.quantity or 0)
        start = body.find(amount.rest) if amount.quantity is not None else 0
        body = f"{shown(total)} {body[max(start, 0) :]}"
    spans = todo_fields.field_spans(body)
    cut = spans[0][0] if spans else len(body)
    head, tail = body[:cut].rstrip(), body[cut:]
    names = [name.strip() for name in linked] + new
    tail = f" {tail.lstrip()}" if tail.strip() else ""
    return f"- [ ] {head}{_links(names)}{tail}{ending}", True


def _new_line(need: Need) -> str:
    quantity = need.quantity(list(need.shares))
    words = need.words if quantity is None else f"{shown(quantity)} {need.words}"
    return f"- [ ] {words}{_links(list(need.shares))}"


def _section_end(lines: list[str], name: str) -> int | None:
    """Where a new line under `## name` goes: after its last non-blank line, or None."""
    start = next(
        (n for n, line in enumerate(lines) if (h := HEADING.fullmatch(line)) and h[1] == name),
        None,
    )
    if start is None:
        return None
    end = start + 1
    for number in range(start + 1, len(lines)):
        if HEADING.fullmatch(lines[number]):
            break
        if lines[number].strip():
            end = number + 1
    return end


def merge(text: str, wanted: list[Need]) -> Merged:
    """`text` with each need added, by aisle in aisle order, or merged into its open line."""
    lines = text.split("\n")
    # A CRLF list keeps its endings on the lines added to it.
    ending = "\r" if "\r\n" in text else ""
    result = Merged(text)
    fresh: dict[str, list[str]] = {}
    for need in wanted:
        at = _open_lines(lines).get(need.key)
        if at is None:
            fresh.setdefault(aisle(need), []).append(_new_line(need) + ending)
            continue
        lines[at], changed = _topped(lines[at], need)
        result.merged += changed
        result.skipped += not changed
    while lines and lines[-1] in ("", "\r"):
        lines.pop()
    for name in ORDER:
        for line in fresh.get(name, []):
            end = _section_end(lines, name)
            if end is None:
                heading = f"## {name}{ending}"
                lines += [ending, heading] if lines else [heading]
                end = len(lines)
            lines.insert(end, line)
            result.added += 1
    result.text = "\n".join(lines) + "\n"
    return result
