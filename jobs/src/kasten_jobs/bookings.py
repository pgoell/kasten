"""A bank's record turned into the booking kasten's ingest takes, and the key it is stored by.

The source key starts with the `external_id` the Firefly importer wrote, so
the Firefly history import (#1033) and a bank pull name the same booking
alike, and ends in an occurrence index. The full spec is in
docs/reference/bank-sync.md#the-source-key.
"""

import hashlib
from datetime import date
from decimal import Decimal
from typing import Any


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


def _plain(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, date | Decimal):
        return str(value)
    amount = getattr(value, "amount", None)
    if amount is not None:
        return {"amount": str(amount), "currency": getattr(value, "currency", None)}
    return str(value)


def to_bookings(bank: str, iban: str, account_id: int, records: list[dict[str, Any]]) -> list[dict]:
    """The bookings for one account's records, in the bank's order, each with its source key.

    Records alike in every part of the key, two coffees of one price on one
    day, get `:0`, `:1` and so on in the order the bank lists them. The index
    holds still from pull to pull because a window always covers whole days.
    """
    seen: dict[str, int] = {}
    bookings = []
    for record in records:
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
                "counterparty_name": record.get("applicant_name"),
                "counterparty_iban": record.get("applicant_iban"),
                "bank_ref": record.get("prima_nota") or record.get("end_to_end_reference"),
                "raw": {key: _plain(value) for key, value in record.items()},
                "source_key": f"{prefix}:{occurrence}",
            }
        )
    return bookings
