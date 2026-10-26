"""The money and safety rules review found missing: each test failed before its fix.

Shared bookings through the receipt queue, a confirm over a hand mark, §35a
without a labour share, a deleted mail receipt coming back, the size caps,
the allowance by year, writes from another site and formulas in the CSV.
"""

import csv
import io
from typing import TYPE_CHECKING

from backend.tests.finance_rows import API, GIRO, account, booking, post
from backend.tests.finance_tax_rows import JPEG, PDF, RECEIPTS, ids, kept, mark, upload, year
from backend.tests.test_finance_budget import SHARED, own
from kasten_backend.finance_receipts import IMAGE_BYTES, MAX_BYTES, MAX_SHARED

if TYPE_CHECKING:
    from httpx import AsyncClient

READ = {"date": "2026-10-01", "amount": "476.00", "payee": "Huber", "form_line": "handwerker"}


async def read(client: AsyncClient, receipt_id: int, **fields: str) -> None:
    response = await client.put(f"{RECEIPTS}/{receipt_id}/reading", json={**READ, **fields})
    assert response.status_code == 200, response.text


async def test_a_shared_booking_gets_no_proposed_amount_and_no_mark_without_one(
    finance_client: AsyncClient,
) -> None:
    shared = await own(finance_client, "Shared", SHARED, "giro", shared=True)
    await post(finance_client, [booking(shared, "garden", "-476.00", booking_date="2026-10-05")])
    rows = await ids(finance_client)
    receipt = await kept(finance_client)
    await read(finance_client, receipt["id"], labour="300.00")

    [queued] = (await finance_client.get(f"{RECEIPTS}/to-sort")).json()
    url = f"{RECEIPTS}/{receipt['id']}/confirm"
    whole = await finance_client.post(
        url, json={"transaction_id": rows["garden"], "form_line": "handwerker"}
    )
    share = await finance_client.post(
        url,
        json={"transaction_id": rows["garden"], "form_line": "handwerker", "tax_amount": "150"},
    )

    assert [(c["tax_amount"], c["shared"]) for c in queued["candidates"]] == [(None, True)]
    assert whole.status_code == 422
    assert share.status_code == 200, share.text
    assert (await year(finance_client, 2026))["entries"][0]["tax_amount"] == "150.00"


async def test_confirm_does_not_overwrite_a_hand_mark_unless_told(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "laptop", "-1000.00")])
    rows = await ids(finance_client)
    await mark(finance_client, rows["laptop"], "werbungskosten", tax_amount="400.00")
    receipt = await kept(finance_client)
    url = f"{RECEIPTS}/{receipt['id']}/confirm"
    body = {"transaction_id": rows["laptop"], "form_line": "werbungskosten"}

    kept_mark = await finance_client.post(url, json=body)
    after = await year(finance_client, 2026)
    replaced = await finance_client.post(url, json={**body, "replace": True})

    assert kept_mark.status_code == 409
    assert "400.00" in kept_mark.json()["detail"]
    assert after["entries"][0]["tax_amount"] == "400.00"
    assert after["entries"][0]["receipt_ids"] == []
    assert replaced.status_code == 200
    assert (await year(finance_client, 2026))["entries"][0]["tax_amount"] == "1000.00"


async def test_section_35a_takes_the_labour_share_never_the_whole_invoice(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "painter", "-476.00")])
    rows = await ids(finance_client)

    for line in ("handwerker", "haushaltsnahe_dienste"):
        whole = await mark(finance_client, rows["painter"], line)
        assert whole.status_code == 422
        assert "labour" in whole.json()["detail"]
    labour = await mark(finance_client, rows["painter"], "handwerker", tax_amount="300")

    assert labour.status_code == 200


async def test_a_deleted_receipt_stays_gone_when_the_mail_job_sends_it_again(
    finance_client: AsyncClient,
) -> None:
    first = await kept(finance_client, source="mail")
    deleted = await finance_client.delete(f"{RECEIPTS}/{first['id']}")

    again = await upload(finance_client, source="mail")
    queue = (await finance_client.get(f"{RECEIPTS}/to-sort")).json()
    unread = (await finance_client.get(RECEIPTS)).json()
    file = await finance_client.get(f"{RECEIPTS}/{first['id']}/file")
    by_hand = await upload(finance_client)

    assert deleted.status_code == 204
    assert again.json()["created"] is False
    assert (queue, unread) == ([], [])
    assert file.status_code == 404
    # Dropped again by the owner, it is back.
    assert by_hand.json()["created"] is True
    assert (await finance_client.get(f"{RECEIPTS}/{first['id']}/file")).content == PDF


async def test_a_body_over_the_cap_is_refused_before_it_is_read(
    finance_client: AsyncClient,
) -> None:
    declared = await finance_client.post(
        RECEIPTS,
        content=b"x",
        headers={
            "content-type": "multipart/form-data; boundary=b",
            "content-length": str(MAX_BYTES + 10**6),
        },
    )
    big_photo = await upload(finance_client, JPEG + b"\0" * IMAGE_BYTES, "photo.jpg")
    many = [("receipts", (f"{n}.pdf", PDF + bytes([n]))) for n in range(MAX_SHARED + 2)]
    shared = await finance_client.post(f"{RECEIPTS}/share", files=many)

    assert declared.status_code == 413
    assert big_photo.status_code == 422
    assert "7 MB" in big_photo.json()["detail"]
    assert shared.headers["location"] == f"/capture?receipts={MAX_SHARED}&refused=2"


async def test_a_streamed_body_past_the_cap_is_cut_off(finance_client: AsyncClient) -> None:
    async def chunks():
        yield b'--b\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n\r\n'
        for _ in range(MAX_BYTES // (1024 * 1024) + 2):
            yield b"0" * 1024 * 1024

    response = await finance_client.post(
        RECEIPTS, content=chunks(), headers={"content-type": "multipart/form-data; boundary=b"}
    )

    assert response.status_code == 413


async def test_the_allowance_is_the_one_of_the_year(finance_client: AsyncClient) -> None:
    assert [(await year(finance_client, n))["allowance"] for n in (2021, 2022, 2023, 2026)] == [
        "1000.00",
        "1200.00",
        "1230.00",
        "1230.00",
    ]


async def test_a_write_from_another_site_is_refused(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "gift", "-25.00")])
    rows = await ids(finance_client)
    url = f"{API}/transactions/{rows['gift']}/tax-mark"
    body = {"form_line": "sonderausgaben"}

    elsewhere = await finance_client.put(url, json=body, headers={"sec-fetch-site": "cross-site"})
    old_browser = await finance_client.post(
        f"{RECEIPTS}/share", data={"text": "x"}, headers={"origin": "https://evil.test"}
    )
    own_page = await finance_client.put(url, json=body, headers={"sec-fetch-site": "same-origin"})
    share_sheet = await finance_client.post(
        f"{RECEIPTS}/share", data={"text": "x"}, headers={"sec-fetch-site": "none"}
    )
    reading = await finance_client.get(f"{API}/tax/2026", headers={"sec-fetch-site": "cross-site"})

    assert (elsewhere.status_code, old_browser.status_code) == (403, 403)
    assert (own_page.status_code, share_sheet.status_code, reading.status_code) == (200, 303, 200)


async def test_a_csv_cell_never_starts_a_formula(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    payee = '=HYPERLINK("https://evil.test","x")'
    await post(
        finance_client,
        [booking(giro, "evil", "-20.00", counterparty_name=payee, purpose="@SUM(1)")],
    )
    rows = await ids(finance_client)
    await mark(finance_client, rows["evil"], "sonderausgaben", note="+1")

    text = (await finance_client.get(f"{API}/tax/2026/lines/sonderausgaben.csv")).text

    [row] = list(csv.DictReader(io.StringIO(text)))
    assert (row["payee"], row["purpose"], row["note"]) == (f"'{payee}", "'@SUM(1)", "'+1")
    assert row["booking_amount"] == "-20.00"
