"""Receipts: kept by hash beside the vault, read, proposed to a booking, confirmed by hand.

Through the routes on a migrated database; see the `finance_session`
fixture. The receipts folder is the test's own (`startup_vault` in conftest).
"""

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.tests.finance_rows import API, GIRO, account, booking, post
from backend.tests.finance_tax_rows import JPEG, PDF, PNG, RECEIPTS, ids, kept, totals, upload, year
from kasten_backend import agent_finance, db
from kasten_backend.config import get_settings
from kasten_backend.finance_receipts import MAX_BYTES

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from httpx import AsyncClient


def on_disk() -> list[Path]:
    root = get_settings().receipts_path
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


async def test_a_receipt_is_kept_once_by_its_bytes_and_served_as_its_type(
    finance_client: AsyncClient,
) -> None:
    first = await upload(finance_client, PDF, "Rechnung.pdf")
    again = await upload(finance_client, PDF, "copy.pdf", source="mail")
    photo = await kept(finance_client, JPEG)

    assert first.json()["created"] is True
    assert again.json()["created"] is False
    assert again.json()["receipt"]["id"] == first.json()["receipt"]["id"]
    assert again.json()["receipt"]["source"] == "upload"
    assert len(on_disk()) == 2
    served = await finance_client.get(f"{RECEIPTS}/{photo['id']}/file")
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/jpeg"
    assert served.headers["x-content-type-options"] == "nosniff"
    assert served.content == JPEG


async def test_what_is_no_pdf_jpeg_or_png_is_refused_by_its_bytes(
    finance_client: AsyncClient,
) -> None:
    html = await upload(finance_client, b"<html><script>alert(1)</script>", "receipt.pdf")
    empty = await upload(finance_client, b"", "receipt.pdf")
    huge = await upload(finance_client, PDF + b"0" * MAX_BYTES, "big.pdf")
    png = await upload(finance_client, PNG, "scan.png")

    assert (html.status_code, empty.status_code, huge.status_code) == (422, 422, 422)
    assert png.status_code == 200
    assert len(on_disk()) == 1


async def test_a_receipt_dropped_on_a_booking_is_its_and_no_other_bookings(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "a", "-10.00"), booking(giro, "b", "-20.00")])
    rows = await ids(finance_client)

    on_a = await upload(finance_client, transaction_id=rows["a"])
    on_b = await upload(finance_client, transaction_id=rows["b"])
    nowhere = await upload(finance_client, PNG, transaction_id=999_999_999)

    assert on_a.json()["receipt"]["transaction_id"] == rows["a"]
    assert on_b.status_code == 409
    assert nowhere.status_code == 422
    queue = (await finance_client.get(f"{RECEIPTS}/to-sort")).json()
    assert queue == []


async def test_a_receipt_sent_unlinked_is_linked_when_dropped_on_its_booking(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "a", "-10.00")])
    rows = await ids(finance_client)
    loose = await kept(finance_client)

    dropped = await upload(finance_client, transaction_id=rows["a"])

    assert dropped.json()["receipt"]["id"] == loose["id"]
    assert dropped.json()["receipt"]["transaction_id"] == rows["a"]


async def test_the_share_sheet_keeps_the_files_and_passes_the_text_on(
    finance_client: AsyncClient,
) -> None:
    text = await finance_client.post(
        f"{RECEIPTS}/share", data={"title": "A page", "url": "https://example.test/x"}
    )
    files = await finance_client.post(
        f"{RECEIPTS}/share",
        data={"text": "Handwerker"},
        files=[("receipts", ("a.pdf", PDF, "application/pdf")), ("receipts", ("b.txt", b"hi"))],
    )

    assert text.status_code == 303
    assert text.headers["location"] == "/capture?title=A+page&url=https%3A%2F%2Fexample.test%2Fx"
    assert files.status_code == 303
    assert files.headers["location"] == "/capture?text=Handwerker&receipts=1&refused=1"
    queue = (await finance_client.get(f"{RECEIPTS}/to-sort")).json()
    assert [(q["receipt"]["source"], q["receipt"]["name"]) for q in queue] == [("capture", "a.pdf")]


async def test_a_reading_proposes_the_booking_it_paid_and_the_labour_share(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            booking(giro, "other", "-476.00", booking_date="2026-10-02", purpose="Bike shop"),
            booking(
                giro,
                "painter",
                "-476.00",
                booking_date="2026-10-28",
                counterparty_name="Malerbetrieb Huber GmbH",
            ),
            booking(giro, "far", "-476.00", booking_date="2026-03-01", purpose="Huber"),
        ],
    )
    rows = await ids(finance_client)
    receipt = await kept(finance_client)
    unread = (await finance_client.get(RECEIPTS)).json()

    reading = {
        "date": "2026-10-01",
        "amount": "476.00",
        "payee": "Malerbetrieb Huber",
        "labour": "300.00",
        "form_line": "handwerker",
    }
    stored = await finance_client.put(f"{RECEIPTS}/{receipt['id']}/reading", json=reading)

    assert [r["id"] for r in unread] == [receipt["id"]]
    assert stored.status_code == 200, stored.text
    assert (await finance_client.get(RECEIPTS)).json() == []
    queue = (await finance_client.get(f"{RECEIPTS}/to-sort")).json()
    candidates = queue[0]["candidates"]
    # The one that names the payee first, then by date; out of the window never.
    assert [c["transaction_id"] for c in candidates] == [rows["painter"], rows["other"]]
    assert candidates[0]["tax_amount"] == "300.00"
    assert queue[0]["form_line"] == "handwerker"
    # A proposal is no link and no mark.
    assert totals(await year(finance_client, 2026)) == {}


async def test_confirm_links_and_marks_together_or_not_at_all(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "doctor", "-120.00", purpose="Praxis")])
    rows = await ids(finance_client)
    receipt = await kept(finance_client)
    url = f"{RECEIPTS}/{receipt['id']}/confirm"

    refused = await finance_client.post(
        url,
        json={
            "transaction_id": rows["doctor"],
            "form_line": "aussergewoehnliche_belastungen",
            "tax_amount": "130.00",
        },
    )
    after_refusal = (await finance_client.get(f"{API}/transactions/{rows['doctor']}/tax")).json()
    confirmed = await finance_client.post(
        url, json={"transaction_id": rows["doctor"], "form_line": "aussergewoehnliche_belastungen"}
    )

    assert refused.status_code == 422
    assert after_refusal == {"mark": None, "receipts": []}
    assert confirmed.status_code == 200, confirmed.text
    summary = await year(finance_client, 2026)
    assert totals(summary) == {"aussergewoehnliche_belastungen": "120.00"}
    assert summary["entries"][0]["receipt_status"] == "attached"
    assert (await finance_client.get(f"{RECEIPTS}/to-sort")).json() == []


async def test_a_receipt_put_aside_leaves_the_queue_and_a_deleted_one_its_file(
    finance_client: AsyncClient,
) -> None:
    aside = await kept(finance_client, PDF)
    gone = await kept(finance_client, PNG)

    patched = await finance_client.patch(f"{RECEIPTS}/{aside['id']}", json={"dismissed": True})
    deleted = await finance_client.delete(f"{RECEIPTS}/{gone['id']}")

    assert patched.json()["dismissed"] is True
    assert deleted.status_code == 204
    assert (await finance_client.get(f"{RECEIPTS}/to-sort")).json() == []
    assert [p.suffix for p in on_disk()] == [".pdf"]
    assert (await finance_client.get(f"{RECEIPTS}/{gone['id']}/file")).status_code == 404


async def test_a_receipt_taken_off_its_booking_makes_the_mark_miss_it(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "gift", "-30.00", purpose="Spende")])
    rows = await ids(finance_client)
    receipt = await kept(finance_client, transaction_id=rows["gift"])
    await finance_client.put(
        f"{API}/transactions/{rows['gift']}/tax-mark", json={"form_line": "sonderausgaben"}
    )

    off = await finance_client.patch(f"{RECEIPTS}/{receipt['id']}", json={"transaction_id": None})

    assert off.json()["transaction_id"] is None
    assert (await year(finance_client, 2026))["entries"][0]["receipt_status"] == "missing"


async def test_with_no_database_a_share_still_opens_capture_with_its_text(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    nowhere = create_async_engine("postgresql+psycopg://x:x@127.0.0.1:1/x")
    monkeypatch.setattr(db, "session_factory", async_sessionmaker(nowhere))
    monkeypatch.setattr(agent_finance, "sessions", db.get_session)

    text = await client.post(f"{RECEIPTS}/share", data={"text": "a thought"})
    files = await client.post(
        f"{RECEIPTS}/share", data={"text": "x"}, files=[("receipts", ("a.pdf", PDF))]
    )

    assert (text.status_code, text.headers["location"]) == (303, "/capture?text=a+thought")
    assert files.headers["location"] == "/capture?text=x&receipts=0&refused=1"
    await nowhere.dispose()
