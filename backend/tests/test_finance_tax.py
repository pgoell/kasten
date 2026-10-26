"""Tax marks and the tax year: the money rules a mark is held to, and what each line totals.

Every test goes through the routes, on a migrated database, and skips
without one; see the `finance_session` fixture.
"""

from typing import TYPE_CHECKING

from backend.tests.finance_order_rows import paypal, paypal_booking, refund, send
from backend.tests.finance_rows import API, GIRO, SAVING, account, booking, category, post
from backend.tests.finance_tax_rows import ids, kept, mark, totals, year
from backend.tests.test_finance_budget import SHARED, own

if TYPE_CHECKING:
    from httpx import AsyncClient


async def test_a_mark_counts_the_whole_booking_on_its_line_in_the_year_it_was_paid(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            booking(giro, "old", "-100.00", booking_date="2025-12-31", purpose="Fachbuch"),
            booking(giro, "new", "-40.00", booking_date="2026-01-01", purpose="Fachbuch 2"),
        ],
    )
    rows = await ids(finance_client)

    for key in ("old", "new"):
        response = await mark(finance_client, rows[key], "werbungskosten")
        assert response.status_code == 200, response.text

    # By the day paid, so New Year's Eve stays in the old year.
    assert totals(await year(finance_client, 2025)) == {"werbungskosten": "100.00"}
    assert totals(await year(finance_client, 2026)) == {"werbungskosten": "40.00"}


async def test_werbungskosten_count_only_over_the_allowance(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            booking(giro, "laptop", "-1000.00", purpose="Laptop"),
            booking(giro, "desk", "-400.00", purpose="Desk"),
        ],
    )
    rows = await ids(finance_client)
    await mark(finance_client, rows["laptop"], "werbungskosten")

    below = await year(finance_client, 2026)
    await mark(finance_client, rows["desk"], "werbungskosten")
    over = await year(finance_client, 2026)

    assert (below["allowance"], below["werbungskosten_over"]) == ("1230.00", "0.00")
    assert over["werbungskosten_over"] == "170.00"


async def test_a_cost_paid_back_by_the_employer_comes_off_its_line(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            booking(giro, "hotel", "-200.00", purpose="Hotel Messe"),
            booking(giro, "back", "150.00", purpose="Reisekosten Erstattung"),
        ],
    )
    rows = await ids(finance_client)
    await mark(finance_client, rows["hotel"], "werbungskosten")

    response = await mark(finance_client, rows["back"], "werbungskosten")

    assert response.status_code == 200, response.text
    summary = await year(finance_client, 2026)
    assert totals(summary) == {"werbungskosten": "50.00"}
    assert {e["transaction_id"]: e["counted"] for e in summary["entries"]} == {
        rows["hotel"]: "200.00",
        rows["back"]: "-150.00",
    }


async def test_a_tax_amount_over_the_booking_is_refused_and_a_lower_one_counts(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "repair", "-500.00", purpose="Malerbetrieb")])
    rows = await ids(finance_client)

    over = await mark(finance_client, rows["repair"], "handwerker", tax_amount="500.01")
    labour = await mark(finance_client, rows["repair"], "handwerker", tax_amount="320.00")
    nothing = await mark(finance_client, rows["repair"], "handwerker", tax_amount="0")

    assert over.status_code == 422
    assert "more than the booking" in over.json()["detail"]
    assert labour.status_code == 200
    assert nothing.status_code == 422
    assert totals(await year(finance_client, 2026)) == {"handwerker": "320.00"}


async def test_a_move_between_own_accounts_takes_no_mark(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    saving = await own(finance_client, "Saving", SAVING, "saving")
    await post(
        finance_client,
        [
            booking(giro, "out", "-300.00", counterparty_iban=SAVING),
            booking(saving, "in", "300.00", counterparty_iban=GIRO),
        ],
    )
    rows = await ids(finance_client)

    response = await mark(finance_client, rows["out"], "sonderausgaben")

    assert response.status_code == 422
    assert "move between own accounts" in response.json()["detail"]


async def test_section_35a_refuses_cash(finance_client: AsyncClient) -> None:
    made = await finance_client.post(f"{API}/accounts", json={"name": "Wallet", "kind": "cash"})
    wallet = made.json()["id"]
    await post(finance_client, [booking(wallet, "cleaner", "-60.00", purpose="Putzhilfe")])
    rows = await ids(finance_client)

    refused = await mark(finance_client, rows["cleaner"], "haushaltsnahe_dienste")
    medical = await mark(finance_client, rows["cleaner"], "aussergewoehnliche_belastungen")

    assert refused.status_code == 422
    assert "never cash" in refused.json()["detail"]
    assert medical.status_code == 200


async def test_a_mark_on_the_shared_account_names_the_owners_share(
    finance_client: AsyncClient,
) -> None:
    shared = await own(finance_client, "Shared", SHARED, "giro", shared=True)
    await post(finance_client, [booking(shared, "garden", "-800.00", purpose="Gartenpflege")])
    rows = await ids(finance_client)

    whole = await mark(finance_client, rows["garden"], "haushaltsnahe_dienste")
    half = await mark(finance_client, rows["garden"], "haushaltsnahe_dienste", tax_amount="400")

    assert whole.status_code == 422
    assert "your share" in whole.json()["detail"]
    assert half.status_code == 200
    summary = await year(finance_client, 2026)
    assert totals(summary) == {"haushaltsnahe_dienste": "400.00"}
    assert summary["entries"][0]["shared"] is True


async def test_a_split_booking_counts_once_whatever_its_parts(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "amazon", "-60.00", purpose="Amazon")])
    rows = await ids(finance_client)
    parts = [{"amount": "-25.00", "text": "Fachbuch"}, {"amount": "-35.00", "text": "Mug"}]
    split = await finance_client.put(f"{API}/transactions/{rows['amazon']}/splits", json=parts)
    assert split.status_code == 200, split.text

    await mark(finance_client, rows["amazon"], "werbungskosten", tax_amount="25.00")

    summary = await year(finance_client, 2026)
    assert totals(summary) == {"werbungskosten": "25.00"}
    assert len(summary["entries"]) == 1


async def test_a_receipt_on_the_booking_is_what_attached_means(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            booking(giro, "doctor", "-90.00", purpose="Zahnarzt"),
            booking(giro, "church", "-50.00", purpose="Spende"),
            booking(giro, "pension", "-70.00", purpose="Riester"),
        ],
    )
    rows = await ids(finance_client)
    await mark(finance_client, rows["doctor"], "aussergewoehnliche_belastungen")
    await mark(finance_client, rows["church"], "sonderausgaben")
    await mark(finance_client, rows["pension"], "sonderausgaben", receipt_needed=False)
    await kept(finance_client, transaction_id=rows["doctor"])

    summary = await year(finance_client, 2026)

    statuses = {e["transaction_id"]: e["receipt_status"] for e in summary["entries"]}
    assert statuses == {
        rows["doctor"]: "attached",
        rows["church"]: "missing",
        rows["pension"]: "not_needed",
    }
    assert [e["transaction_id"] for e in summary["missing"]] == [rows["church"]]
    lines = {line["form_line"]: line["missing"] for line in summary["lines"]}
    assert lines["sonderausgaben"] == 1
    tax = (await finance_client.get(f"{API}/transactions/{rows['doctor']}/tax")).json()
    assert tax["mark"]["receipt_status"] == "attached"
    assert len(tax["receipts"]) == 1


async def test_money_back_on_a_marked_cost_is_listed_until_marked(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    work = await category(finance_client, "Work costs", "ignore")
    await post(
        finance_client,
        [
            booking(giro, "train", "-80.00", purpose="DB Dienstreise"),
            booking(giro, "paid", "80.00", purpose="Erstattung Arbeitgeber"),
            paypal_booking(giro, "pp"),
            paypal_booking(giro, "pp-back", "12.00", booking_date="2026-10-23"),
        ],
    )
    rows = await ids(finance_client)
    for key in ("train", "paid"):
        await finance_client.put(
            f"{API}/transactions/{rows[key]}/category", json={"category_id": work}
        )
    order = paypal()
    order["charges"].append(refund("back", "12.00"))
    await send(finance_client, [order])
    await mark(finance_client, rows["train"], "werbungskosten")
    await mark(finance_client, rows["pp"], "werbungskosten")

    listed = await year(finance_client, 2026)
    await mark(finance_client, rows["paid"], "werbungskosten")
    after = await year(finance_client, 2026)

    assert [m["transaction_id"] for m in listed["money_back"]] == [rows["paid"], rows["pp-back"]]
    assert [m["transaction_id"] for m in after["money_back"]] == [rows["pp-back"]]
    assert totals(after) == {"werbungskosten": "30.00"}


async def test_a_mark_changes_and_goes(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [booking(giro, "gift", "-25.00", purpose="Spende")])
    rows = await ids(finance_client)
    await mark(finance_client, rows["gift"], "werbungskosten")

    changed = await mark(finance_client, rows["gift"], "sonderausgaben", note="UNICEF")
    gone = await finance_client.delete(f"{API}/transactions/{rows['gift']}/tax-mark")
    again = await finance_client.delete(f"{API}/transactions/{rows['gift']}/tax-mark")
    missing = await mark(finance_client, 999_999_999, "sonderausgaben")

    assert changed.json()["form_line"] == "sonderausgaben"
    assert changed.json()["note"] == "UNICEF"
    assert (gone.status_code, again.status_code, missing.status_code) == (204, 404, 404)
    assert totals(await year(finance_client, 2026)) == {}
