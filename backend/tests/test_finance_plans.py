"""The plan and goal routes: plans matched on ingest, the month's dates, reserves, goals, proposals.

Through the routes on a migrated database, skipped without one; see the
`finance_session` fixture. The rules themselves are tested without a
database in test_finance_plans_model.py.
"""

from typing import TYPE_CHECKING, Any

from backend.tests.finance_rows import API, GIRO, SAVING, booking, category, post
from backend.tests.test_finance_budget import own

if TYPE_CHECKING:
    from httpx import AsyncClient

TODAY = {"month": "2026-10", "today": "2026-10-10"}


async def plan(client: AsyncClient, **fields: Any) -> dict[str, Any]:
    response = await client.post(f"{API}/plans", json=fields)
    assert response.status_code == 200, response.text
    return response.json()


async def setup(client: AsyncClient) -> dict[str, int]:
    giro = await own(client, "Giro", GIRO, "giro")
    ids = {
        "giro": giro,
        "saving": await own(client, "Saving", SAVING, "saving"),
        "salary": await category(client, "Salary", "income"),
        "insurance": await category(client, "Insurance", "non_monthly"),
    }
    await post(
        client,
        [
            booking(giro, "pay", "3000.00", booking_date="2026-10-01", purpose="Lohn"),
            booking(
                giro,
                "bill",
                "-597.00",
                booking_date="2026-10-04",
                counterparty_name="HUK Coburg",
                purpose="Beitrag 2027",
                raw={"firefly": {"bill": "Haftpflicht"}},
            ),
        ],
    )
    rows = (await client.get(f"{API}/transactions")).json()
    by_key = {row["source_key"]: row for row in rows}
    for key, kind in (("pay", "salary"), ("bill", "insurance")):
        await client.put(
            f"{API}/transactions/{by_key[key]['id']}/category", json={"category_id": ids[kind]}
        )
    ids["payee"] = by_key["bill"]["payee_id"]
    return ids


async def test_a_plan_matches_its_bill_and_the_reserve_pays_it(finance_client: AsyncClient) -> None:
    ids = await setup(finance_client)
    made = await plan(
        finance_client,
        name="Haftpflicht",
        account_id=ids["giro"],
        payee_id=ids["payee"],
        amount="-600.00",
        tolerance="5.00",
        every_months=12,
        category_id=ids["insurance"],
        start="2026-10-01",
    )
    assert (made["reserves"], made["share"]) == (True, "50.00")
    due = (await finance_client.get(f"{API}/plans/upcoming", params={"month": "2026-10"})).json()
    assert due[0]["match"]["amount"] == "-597.00"
    free = (await finance_client.get(f"{API}/budget/free", params=TODAY)).json()["mine"]
    assert free["non_monthly"]["lines"] == []
    assert free["reserves"]["lines"][0] | {"plan_id": 0} == {
        "plan_id": 0,
        "name": "Haftpflicht",
        "share": "50.00",
        "paid": "597.00",
        "balance": "3.00",
    }
    assert free["total"] == "2950.00"


async def test_a_plan_needs_a_payee_or_a_text(finance_client: AsyncClient) -> None:
    giro = await own(finance_client, "Giro", GIRO, "giro")
    body = {"name": "Rent", "account_id": giro, "amount": "-900", "start": "2026-10-01"}
    assert (await finance_client.post(f"{API}/plans", json=body)).status_code == 422
    made = await plan(finance_client, **body, text="Miete")
    changed = await finance_client.put(
        f"{API}/plans/{made['id']}", json={**body, "text": "Miete", "every_months": None}
    )
    assert changed.json()["every_months"] is None
    assert (await finance_client.delete(f"{API}/plans/{made['id']}")).status_code == 204
    assert (await finance_client.get(f"{API}/plans")).json() == []


async def test_proposals_come_from_the_firefly_bills_and_confirm_as_they_are(
    finance_client: AsyncClient,
) -> None:
    await setup(finance_client)
    found = (await finance_client.get(f"{API}/plans/proposals", params=TODAY)).json()
    assert [(p["source"], p["name"], p["every_months"]) for p in found] == [
        ("bill", "Haftpflicht", 12)
    ]
    keep = {"key", "source", "seen", "last"}
    await plan(finance_client, **{k: v for k, v in found[0].items() if k not in keep})
    assert (await finance_client.get(f"{API}/plans/proposals", params=TODAY)).json() == []


async def test_goals_reserve_no_more_than_the_balance_and_contribute_monthly(
    finance_client: AsyncClient,
) -> None:
    ids = await setup(finance_client)
    await finance_client.post(
        f"{API}/balances",
        json=[{"account_id": ids["saving"], "date": "2026-10-09", "amount": "1000"}],
    )
    goal = {"name": "Wedding", "target": "12000", "due": "2027-04-01", "account_id": ids["saving"]}
    refused = await finance_client.post(f"{API}/goals", json={**goal, "reserved": "1000.01"})
    assert refused.status_code == 422
    assert "1000.00 is unreserved" in refused.json()["detail"]
    giro = await finance_client.post(f"{API}/goals", json={**goal, "account_id": ids["giro"]})
    assert giro.status_code == 422
    await finance_client.post(f"{API}/goals", json={**goal, "reserved": "600", "monthly": "500"})
    read = (await finance_client.get(f"{API}/goals", params={"today": "2026-10-10"})).json()
    assert read["accounts"][0] | {"id": 0} == {
        "id": 0,
        "name": "Saving",
        "balance": "1000.00",
        "balance_date": "2026-10-09",
        "reserved": "600.00",
        "unreserved": "400.00",
    }
    wedding = read["goals"][0]
    assert (wedding["progress"], wedding["need"]) == ("0.0500", "1900.00")
    assert wedding["this_month"] == {"planned": "500.00", "moved": "0.00", "done": False}
    free = (await finance_client.get(f"{API}/budget/free", params=TODAY)).json()["mine"]
    assert free["goals"]["total"] == "500.00"


async def test_the_forecast_starts_at_the_bank_balance(finance_client: AsyncClient) -> None:
    ids = await setup(finance_client)
    await finance_client.post(
        f"{API}/balances",
        json=[{"account_id": ids["giro"], "date": "2026-10-09", "amount": "2403"}],
    )
    await plan(
        finance_client, name="Rent", account_id=ids["giro"], text="Miete", amount="-900",
        start="2026-10-01",
    )  # fmt: skip
    found = (
        await finance_client.get(f"{API}/plans/forecast", params={"today": "2026-10-10"})
    ).json()
    assert found["mine"]["balance"] == "2403.00"
    assert [m["balance"] for m in found["mine"]["months"][:2]] == ["1503.00", "603.00"]
    assert len(found["household"]["months"]) == 12


async def test_a_booking_that_comes_in_after_the_plan_meets_it(finance_client: AsyncClient) -> None:
    ids = await setup(finance_client)
    await plan(
        finance_client, name="Haftpflicht", account_id=ids["giro"], payee_id=ids["payee"],
        amount="-600.00", tolerance="10.00", every_months=12, start="2026-10-01",
    )  # fmt: skip
    later = booking(
        ids["giro"],
        "bill-2027",
        "-605.00",
        booking_date="2027-10-03",
        counterparty_name="HUK Coburg",
    )
    await post(finance_client, [later])
    due = (await finance_client.get(f"{API}/plans/upcoming", params={"month": "2027-10"})).json()
    assert due[0]["match"]["amount"] == "-605.00"
