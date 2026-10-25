"""A bank's record turned into the booking kasten's ingest takes, and the key it is stored by.

The source key starts with the `external_id` the Firefly importer wrote, so
the Firefly history import (#1033) and a bank pull name the same booking
alike, and ends in an occurrence index. The full spec is in
docs/reference/bank-sync.md#the-source-key.
"""

import hashlib
import re
from datetime import date
from decimal import Decimal
from typing import Any

CENT = Decimal("0.01")

# Not followed by a digit, so a name that runs on in digits is not cut.
GERMAN_IBAN = re.compile(r"DE\d{20}(?!\d)")


def spelled(iban: str | None) -> str:
    """An IBAN without spaces and in capitals, as kasten stores it; empty for none."""
    return "".join((iban or "").split()).upper()


def transfer_prefix(iban: str, other: str, day: date | str, amount: Decimal) -> str:
    """The key prefix of a move between two own accounts, the same from either side.

    The old importer's `transfer:<lo>:<hi>:<date>:<abs amount>`, with the two
    IBANs spelled alike and sorted, and the amount always to the cent: the
    bank prints `500` or `500.00` as it likes, and Firefly kept both and
    `500.000000000000` besides.
    """
    lo, hi = sorted((spelled(iban), spelled(other)))
    return f"transfer:{lo}:{hi}:{day}:{abs(amount).quantize(CENT)}"


def key_prefix(bank: str, iban: str, record: dict[str, Any]) -> str:
    """The Firefly importer's `external_id` for the record, computed exactly as it did.

    `date` is the record's `date`, which is the value date, not the booking
    date: that is what Firefly stored, and the key has to match it.
    """
    purpose = " ".join(p for p in (record.get("purpose"), record.get("posting_text")) if p).strip()
    ref = record.get("prima_nota") or record.get("end_to_end_reference") or ""
    # SHA-1 and not `hash()`, which Python salts per process, so the same
    # booking would get a new key every run.
    digest = hashlib.sha1(purpose.encode("utf-8"), usedforsecurity=False).hexdigest()[:12]
    return f"{bank}:{iban}:{record['date']}:{record['amount'].amount}:{ref}:{digest}"


def counterparty(record: dict[str, Any], own: frozenset[str]) -> tuple[str | None, str | None]:
    """The record's counterparty IBAN and name, with an IBAN the bank glued to the name split off.

    DKB's MT940 for a savings account leaves `applicant_iban` empty and starts
    `applicant_name` with the IBAN, no separator: `DE02...2051Pascal`. A
    German IBAN is always 22 characters, so it is cut there; any other
    country's length is only known when it is a kasten account's IBAN.
    """
    iban, name = record.get("applicant_iban"), record.get("applicant_name")
    if spelled(iban) or not name:
        return iban, name
    glued = GERMAN_IBAN.match(name)
    cut = glued.end() if glued else next((len(o) for o in own if name.startswith(o)), 0)
    if not cut:
        return iban, name
    return name[:cut], name[cut:].strip() or None


def _plain(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, date | Decimal):
        return str(value)
    amount = getattr(value, "amount", None)
    if amount is not None:
        return {"amount": str(amount), "currency": getattr(value, "currency", None)}
    return str(value)


def to_bookings(
    bank: str,
    iban: str,
    account_id: int,
    records: list[dict[str, Any]],
    own: frozenset[str] = frozenset(),
) -> list[dict]:
    """The bookings for one account's records, in the bank's order, each with its source key.

    `own` is every kasten account's IBAN, spelled as `spelled` spells it. A
    record whose counterparty is one of them is a move between own accounts
    and takes `transfer_prefix`, as the old importer keyed it. The
    counterparty is read by `counterparty`.

    Records alike in every part of the key, two coffees of one price on one
    day, get `:0`, `:1` and so on in the order the bank lists them. The bank
    picks a window's records by booking date while the key holds the value
    date, so the index holds still from pull to pull only while twins are
    booked within the overlap of each other (`bank_sync.window_start`), and
    the bank lists them by booking date.
    """
    seen: dict[str, int] = {}
    bookings = []
    for record in records:
        their_iban, their_name = counterparty(record, own)
        other = spelled(their_iban)
        if other in own and other != spelled(iban):
            prefix = transfer_prefix(iban, other, record["date"], record["amount"].amount)
        else:
            prefix = key_prefix(bank, iban, record)
        occurrence = seen.get(prefix, 0)
        seen[prefix] = occurrence + 1
        amount = record["amount"]
        bookings.append(
            {
                "account_id": account_id,
                "booking_date": str(record.get("entry_date") or record["date"]),
                "value_date": str(record["date"]),
                "amount": str(amount.amount),
                "currency": getattr(amount, "currency", None) or "EUR",
                "purpose": record.get("purpose"),
                "posting_text": record.get("posting_text"),
                "counterparty_name": their_name,
                "counterparty_iban": their_iban,
                "bank_ref": record.get("prima_nota") or record.get("end_to_end_reference"),
                "raw": {key: _plain(value) for key, value in record.items()},
                "source_key": f"{prefix}:{occurrence}",
            }
        )
    return bookings
