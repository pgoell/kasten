"""A bank's record turned into a booking, and the source key it is stored by.

The key starts with the Firefly importer's `external_id`, so the history import
(#1033) and a bank pull name the same booking alike. See
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

    The amount is always to the cent: the bank prints `500` or `500.00`, and
    Firefly kept both and `500.000000000000` besides.
    """
    lo, hi = sorted((spelled(iban), spelled(other)))
    return f"transfer:{lo}:{hi}:{day}:{abs(amount).quantize(CENT)}"


def key_prefix(bank: str, iban: str, record: dict[str, Any]) -> str:
    """The Firefly importer's `external_id` for the record, computed exactly as it did.

    `date` is the value date, the one Firefly stored.
    """
    purpose = " ".join(p for p in (record.get("purpose"), record.get("posting_text")) if p).strip()
    ref = record.get("prima_nota") or record.get("end_to_end_reference") or ""
    # SHA-1 and not `hash()`, which Python salts per process, so the same
    # booking would get a new key every run.
    digest = hashlib.sha1(purpose.encode("utf-8"), usedforsecurity=False).hexdigest()[:12]
    return f"{bank}:{iban}:{record['date']}:{record['amount'].amount}:{ref}:{digest}"


def counterparty(record: dict[str, Any], own: frozenset[str]) -> tuple[str | None, str | None]:
    """The counterparty IBAN and name, with an IBAN the bank glued onto the name split off.

    DKB's savings MT940 puts `DE02...2051Pascal` in the name. A German IBAN is
    always 22 characters; other countries' lengths are known only from `own`.
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

    A move to an IBAN in `own` takes `transfer_prefix`. Twins get `:0`, `:1`, an
    index stable only while they fall in the overlap (`bank_sync.window_start`).
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
