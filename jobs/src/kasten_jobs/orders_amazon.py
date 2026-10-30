"""Amazon order mails: the order confirmation and the dispatch mail, as amazon.de sends them.

Amazon charges each shipment on its own, so the dispatch mail is the charge. A
digital order (Kindle, Prime Video) ships nothing, so its confirmation holds the
one charge. amazon.de writes physical orders in English and digital ones in German.
"""

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

from kasten_jobs.mail_text import cents, english_amount, german_amount, lines_of

if TYPE_CHECKING:
    from datetime import date

    from kasten_jobs.gmail import Mail

CONFIRMATION = "bestellbestaetigung@amazon.de"
DISPATCH = "versandbestaetigung@amazon.de"

ORDER_ID = re.compile(r"\b(?:\d{3}|D01)-\d{7}-\d{7}\b")
_EUR = re.compile(r"^([\d.,]+) EUR$")
_QUANTITY = re.compile(r"^Quantity: (\d+)$")
_DIGITAL_TOTAL = re.compile(r"Gesamtsumme: EUR ([\d.,]+)")

Item = tuple[str, Decimal]


@dataclass(frozen=True)
class Confirmation:
    """An order as its confirmation states it; `items` only for a digital order's one charge."""

    order_id: str
    day: date
    total: Decimal | None
    items: list[Item] | None


@dataclass(frozen=True)
class Shipment:
    """One dispatch: the mail it came in, its order, its items and what it charged."""

    mail_id: str
    order_id: str
    day: date
    amount: Decimal
    items: list[Item]


def _total(lines: list[str]) -> Decimal | None:
    """The amount on the line after `Total`."""
    for at, line in enumerate(lines[:-1]):
        if line == "Total" and (found := _EUR.match(lines[at + 1])):
            return english_amount(found.group(1))
    return None


def _order_ids(lines: list[str]) -> list[str]:
    """Each order id that follows an `Order #`, once, in the order they come."""
    ids: list[str] = []
    for at, line in enumerate(lines[:-1]):
        if line == "Order #" and (found := ORDER_ID.search(lines[at + 1])):
            ids += [] if found.group(0) in ids else [found.group(0)]
    return ids


def _items(lines: list[str]) -> list[Item]:
    """Each `* title`, `Quantity: n`, `price EUR` as the title and its line price."""
    items: list[Item] = []
    for at, line in enumerate(lines[:-2]):
        quantity = _QUANTITY.match(lines[at + 1])
        price = _EUR.match(lines[at + 2])
        if line.startswith("* ") and quantity and price:
            count = int(quantity.group(1))
            title = line[2:].strip()
            text = title if count == 1 else f"{count} x {title}"
            items.append((text, cents(count * english_amount(price.group(1)))))
    return items


def _digital(mail: Mail, lines: list[str]) -> Confirmation | None:
    found = ORDER_ID.search(mail.text)
    total = _DIGITAL_TOTAL.search(" ".join(lines))
    if found is None or total is None:
        return None
    amount = german_amount(total.group(1))
    # The prices listed are before tax, so the one item carries the total.
    titles = [lines[at - 1] for at, line in enumerate(lines) if line.startswith("Verkauft von:")]
    text = "; ".join(titles) or "Amazon digital order"
    return Confirmation(found.group(0), mail.day, amount, [(text, amount)])


def parse_confirmation(mail: Mail) -> list[Confirmation]:
    """The orders a confirmation names: one, or one per order id when it names several."""
    lines = lines_of(mail.text)
    if any(line.startswith("Bestellnr.") for line in lines):
        digital = _digital(mail, lines)
        return [] if digital is None else [digital]
    ids = _order_ids(lines)
    # The total covers every order the mail names, so it is no one order's.
    total = _total(lines) if len(ids) == 1 else None
    return [Confirmation(order_id, mail.day, total, None) for order_id in ids]


def parse_shipment(mail: Mail) -> Shipment | None:
    """The shipment a dispatch mail announces, or None when it names no one order or no items."""
    lines = lines_of(mail.text)
    ids = _order_ids(lines)
    items = _items(lines)
    if len(ids) != 1 or not items:
        return None
    amount = _total(lines) or sum((a for _, a in items), Decimal(0))
    return Shipment(mail.id, ids[0], mail.day, amount, items)
