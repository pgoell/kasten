"""PayPal mails in German: a payment's receipt and a refund on its way.

A receipt carries a 17-character transaction code, the order's key. PayPal sends
HTML only. A refund carries no code: it names the day and amount of the payment
it refunds, which is how the job finds that payment's order.
"""

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

from kasten_jobs.mail_text import german_amount, german_date, html_lines

if TYPE_CHECKING:
    from datetime import date

    from kasten_jobs.gmail import Mail

SENDER = "service@paypal.de"

_CODE = re.compile(r"\b[0-9A-Z]{17}\b")
_MONEY = r"(-?[\d.]+,\d{2}) € ([A-Z]{3})"
_HEADLINE = re.compile(rf"(?:Sie haben|Du hast) {_MONEY} an (.+?) (?:gezahlt|gesendet)$")
_AMOUNT = re.compile(rf"^{_MONEY}$")
_LINE = re.compile(r"^(-?[\d.]+,\d{2}) €")
_QUANTITY = re.compile(r"^Menge: (\d+)$")
_REFUND = re.compile(rf"Rückzahlung über {_MONEY} von (.+?) wurde veranlasst")
_ORIGINAL = re.compile(rf"ursprünglich am (.+?\d{{4}}) {_MONEY} an (.+?) bezahlt")

Item = tuple[str, Decimal]

TOTALS = ("Gesamtbetrag", "Summe")
"""The labels the total stands under."""


@dataclass(frozen=True)
class Payment:
    """A payment as its receipt states it."""

    code: str
    day: date
    merchant: str
    total: Decimal
    items: list[Item]


@dataclass(frozen=True)
class Refund:
    """A refund, and the day and amount of the payment it refunds."""

    mail_id: str
    day: date
    amount: Decimal
    merchant: str
    paid_on: date
    paid: Decimal


def _after(lines: list[str], label: str) -> str | None:
    """The line after the first that is `label`."""
    for at, line in enumerate(lines[:-1]):
        if line == label:
            return lines[at + 1]
    return None


def _code(lines: list[str]) -> str | None:
    for at, line in enumerate(lines):
        if line.startswith("Transaktionscode"):
            found = _CODE.search(" ".join(lines[at : at + 2]))
            return None if found is None else found.group(0)
    return None


def _total(lines: list[str]) -> tuple[str, Decimal, str] | None:
    """The merchant, total and currency, from the headline or from the receipt's labels."""
    for line in lines:
        if found := _HEADLINE.search(line):
            return found.group(3), german_amount(found.group(1)), found.group(2)
    for label in TOTALS:
        if (line := _after(lines, label)) and (found := _AMOUNT.match(line)):
            merchant = _after(lines, "Zahlung an") or "PayPal"
            return merchant, german_amount(found.group(1)), found.group(2)
    return None


def _listed(lines: list[str]) -> tuple[list[Item], int]:
    """Items as text, `Menge: n` and line price; and the index of the line after the last."""
    items: list[Item] = []
    end = 0
    for at in range(1, len(lines) - 1):
        price = _LINE.match(lines[at + 1])
        if _QUANTITY.match(lines[at]) and price:
            items.append((lines[at - 1], german_amount(price.group(1))))
            end = at + 2
    return items, end


def _table(lines: list[str]) -> tuple[list[Item], int]:
    """Rows of description, unit price, quantity and amount under the table's header."""
    for at in range(len(lines) - 3):
        if lines[at : at + 4] == ["Beschreibung", "Einzelpreis", "Menge", "Betrag"]:
            items: list[Item] = []
            row = at + 4
            while row + 3 < len(lines) and lines[row + 2].isdigit():
                amount = _LINE.match(lines[row + 3])
                if amount is None:
                    break
                items.append((lines[row], german_amount(amount.group(1))))
                row += 4
            return items, row
    return [], 0


def _extras(lines: list[str], start: int) -> list[Item]:
    """Shipping, tax, a discount: each label and amount from `start` to the total, if not zero."""
    extras: list[Item] = []
    for at in range(start, len(lines) - 1):
        if lines[at] in TOTALS:
            break
        found = _LINE.match(lines[at + 1])
        if found and not _LINE.match(lines[at]) and lines[at] != "Zwischensumme":
            amount = german_amount(found.group(1))
            if amount:
                extras.append((lines[at], amount))
    return extras


def _items(lines: list[str], merchant: str, total: Decimal) -> list[Item]:
    """The receipt's lines as it names them; the merchant's one line when they do not add up.

    Not prefixed with the shop, which would let a rule on the shop beat one on the item.
    """
    items, end = _listed(lines)
    if not items:
        items, end = _table(lines)
    items += _extras(lines, end) if items else []
    if not items or sum((a for _, a in items), Decimal(0)) != total:
        return [(merchant, total)]
    return items


def parse_payment(mail: Mail) -> Payment | None:
    """The payment a receipt states, or None for a mail that is none or not in euros."""
    lines = html_lines(mail.html)
    code = _code(lines)
    found = _total(lines)
    if code is None or found is None or found[2] != "EUR":
        return None
    merchant, total, _ = found
    merchant = _after(lines, "Händler") or merchant
    return Payment(code, mail.day, merchant, total, _items(lines, merchant, total))


def parse_refund(mail: Mail) -> Refund | None:
    """The refund a mail announces, or None for a mail that is none or not in euros."""
    text = " ".join(html_lines(mail.html))
    refund = _REFUND.search(text)
    original = _ORIGINAL.search(text)
    if refund is None or original is None or refund.group(2) != "EUR":
        return None
    paid_on = german_date(original.group(1))
    if paid_on is None:
        return None
    return Refund(
        mail_id=mail.id,
        day=mail.day,
        amount=german_amount(refund.group(1)),
        merchant=refund.group(3),
        paid_on=paid_on,
        paid=german_amount(original.group(2)),
    )
