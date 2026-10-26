"""The tax year's exports: a CSV per line, and the receipts named for their bookings in a ZIP."""

import csv
import io
import zipfile
from typing import TYPE_CHECKING

from backend.tests.finance_rows import API, GIRO, account, booking, post
from backend.tests.finance_tax_rows import JPEG, PDF, PNG, ids, kept, mark
from kasten_backend.finance_tax_export import safe

if TYPE_CHECKING:
    from httpx import AsyncClient


def test_a_payee_becomes_a_plain_file_name() -> None:
    assert safe("Müller & Söhne GmbH") == "Mueller-Soehne-GmbH"
    assert safe("../../etc/passwd") == "etc-passwd"
    assert safe("名前") == "unknown"
    assert len(safe("x" * 300)) == 40


async def test_the_zip_names_each_receipt_by_its_booking_and_never_twice_the_same(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    day = {"booking_date": "2026-03-04", "counterparty_name": "Dr. Weiß/Praxis"}
    await post(
        finance_client,
        [
            booking(giro, "one", "-80.50", **day),
            booking(giro, "two", "-80.50", **day),
            booking(giro, "unmarked", "-5.00"),
            booking(giro, "last-year", "-9.00", booking_date="2025-12-30"),
        ],
    )
    rows = await ids(finance_client)
    for key in ("one", "two", "last-year"):
        await mark(finance_client, rows[key], "aussergewoehnliche_belastungen")
    await kept(finance_client, PDF, transaction_id=rows["one"])
    await kept(finance_client, PDF + b"2", transaction_id=rows["two"])
    await kept(finance_client, JPEG, transaction_id=rows["two"])
    await kept(finance_client, PNG, transaction_id=rows["unmarked"])
    await kept(finance_client, PDF + b"%", transaction_id=rows["last-year"])

    response = await finance_client.get(f"{API}/tax/2026/receipts.zip")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(response.content)).namelist()
    assert names == [
        "2026-03-04_Dr-Weiss-Praxis_80.50.pdf",
        "2026-03-04_Dr-Weiss-Praxis_80.50_2.pdf",
        "2026-03-04_Dr-Weiss-Praxis_80.50.jpg",
    ]


async def test_a_line_csv_lists_its_bookings_and_their_receipts(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            booking(giro, "book", "-30.00", purpose="Fachbuch", counterparty_name="Thalia"),
            booking(giro, "back", "10.00", purpose="Erstattung", counterparty_name="Employer"),
            booking(giro, "gift", "-50.00", purpose="Spende"),
        ],
    )
    rows = await ids(finance_client)
    await mark(finance_client, rows["book"], "werbungskosten", note="Arbeitsmittel")
    await mark(finance_client, rows["back"], "werbungskosten")
    await mark(finance_client, rows["gift"], "sonderausgaben")
    await kept(finance_client, PDF, transaction_id=rows["book"])

    response = await finance_client.get(f"{API}/tax/2026/lines/werbungskosten.csv")
    unknown = await finance_client.get(f"{API}/tax/2026/lines/lottery.csv")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    table = list(csv.DictReader(io.StringIO(response.text)))
    assert [(r["payee"], r["counted"], r["receipt_status"], r["receipts"]) for r in table] == [
        ("Thalia", "30.00", "attached", "2026-10-20_Thalia_30.00.pdf"),
        ("Employer", "-10.00", "missing", ""),
    ]
    assert table[0]["note"] == "Arbeitsmittel"
    assert unknown.status_code == 422
