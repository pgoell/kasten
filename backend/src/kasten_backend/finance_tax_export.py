"""The tax year's exports: a CSV of one line's bookings, and a ZIP of the year's receipts.

Both read `finance_tax.entries`, the list the Tax tab totals, so an export never holds
a booking the tab does not count. A receipt in the ZIP is named `YYYY-MM-DD_payee_amount.ext`
by its booking, and the CSV names the same file.
"""

import asyncio
import csv
import io
import re
import unicodedata
import zipfile
from typing import TYPE_CHECKING

from sqlalchemy import select

from kasten_backend.finance_receipts import SUFFIXES
from kasten_backend.finance_tax_models import Receipt

if TYPE_CHECKING:
    from collections.abc import Iterable
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from kasten_backend.finance_tax import Entry

UMLAUTS = str.maketrans(
    {"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"}
)

PAYEE_LENGTH = 40


def safe(text: str) -> str:
    """A payee as a file name may hold it: ASCII letters, digits and hyphens, never empty."""
    folded = unicodedata.normalize("NFKD", text.translate(UMLAUTS))
    plain = folded.encode("ascii", "ignore").decode()
    cut = re.sub(r"[^A-Za-z0-9]+", "-", plain).strip("-")[:PAYEE_LENGTH].strip("-")
    return cut or "unknown"


def file_names(entries: Iterable[Entry], media: dict[int, str]) -> dict[int, str]:
    """Each receipt's name in the ZIP, by receipt id, `_2` and on added where two would clash.

    The amount is the booking's, to the cent, as the bank statement shows it.
    """
    names: dict[int, str] = {}
    taken: set[str] = set()
    for entry in entries:
        stem = f"{entry.booking_date.isoformat()}_{safe(entry.payee)}_{abs(entry.amount):.2f}"
        for receipt_id in entry.receipt_ids:
            if receipt_id in names:
                continue
            suffix = SUFFIXES[media[receipt_id]]
            name, count = f"{stem}{suffix}", 1
            while name.lower() in taken:
                count += 1
                name = f"{stem}_{count}{suffix}"
            taken.add(name.lower())
            names[receipt_id] = name
    return names


async def _receipts(session: AsyncSession, entries: list[Entry]) -> dict[int, Receipt]:
    ids = [receipt_id for entry in entries for receipt_id in entry.receipt_ids]
    found = await session.scalars(select(Receipt).where(Receipt.id.in_(ids)))
    return {receipt.id: receipt for receipt in found}


FORMULA = ("=", "+", "-", "@", "\t", "\r")


def cell(text: str) -> str:
    """A text cell a spreadsheet will not run: one that starts like a formula gets a `'`.

    Payees and purposes come from the bank, where anyone who pays can write them.
    """
    return f"'{text}" if text.startswith(FORMULA) else text


COLUMNS = (
    "date",
    "payee",
    "purpose",
    "booking_amount",
    "tax_amount",
    "counted",
    "receipt_status",
    "receipts",
    "note",
    "transaction_id",
)


async def line_csv(session: AsyncSession, entries: list[Entry], line: str) -> str:
    """One line's bookings as CSV, a row each, with the receipts' names in the ZIP."""
    receipts = await _receipts(session, entries)
    names = file_names(entries, {i: r.media_type for i, r in receipts.items()})
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(COLUMNS)
    for entry in entries:
        if entry.form_line != line:
            continue
        writer.writerow(
            [
                entry.booking_date.isoformat(),
                cell(entry.payee),
                cell(entry.purpose or ""),
                f"{entry.amount:.2f}",
                f"{entry.tax_amount:.2f}",
                f"{entry.counted:.2f}",
                entry.receipt_status,
                " ".join(names[i] for i in entry.receipt_ids),
                cell(entry.note or ""),
                entry.transaction_id,
            ]
        )
    return out.getvalue()


async def receipts_zip(session: AsyncSession, root: Path, entries: list[Entry]) -> bytes:
    """Every receipt of the year's marked bookings, each named for its booking.

    A file gone from disk is left out rather than failing the whole export;
    the CSV still names it.
    """
    receipts = await _receipts(session, entries)
    names = file_names(entries, {i: r.media_type for i, r in receipts.items()})
    files = [(root / receipts[receipt_id].path, name) for receipt_id, name in names.items()]
    return await asyncio.to_thread(_zip, files)


def _zip(files: list[tuple[Path, str]]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, name in files:
            if path.is_file():
                archive.write(path, name)
    return out.getvalue()
