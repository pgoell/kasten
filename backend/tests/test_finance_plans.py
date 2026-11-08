"""The plan and goal routes: plans matched on ingest, the month's dates, reserves, goals, proposals.

Through the routes on a migrated database, skipped without one; see the
`finance_session` fixture. The rules themselves are tested without a
database in test_finance_plans_model.py.
"""

from typing import TYPE_CHECKING, Any

from backend.tests.finance_rows import API, GIRO, SAVING, booking, category, post, stored
from backend.tests.test_finance_budget import own

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

TODAY = {"month": "2026-10", "today": "2026-10-10"}


async def plan(client: AsyncClient, today: str = "2026-10-10", **fields: Any) -> dict[str, Any]:
    response = await client.post(f"{API}/plans", json=fields, params={"today": today})
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
        # Confirmed a year back, so the reserve has set aside all twelve shares.
        today="2025-11-01",
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
        "shortfall": "0.00",
        "balance": "3.00",
    }
    assert free["total"] == "2950.00"


async def test_a_plan_needs_a_payee_or_a_text(finance_client: AsyncClient) -> None:
    giro = await own(finance_client, "Giro", GIRO, "giro")
    body: dict[str, Any] = {
        "name": "Rent",
        "account_id": giro,
        "amount": "-900",
        "start": "2026-10-01",
    }
    refused = await finance_client.post(f"{API}/plans", json=body, params={"today": "2026-10-10"})
    assert refused.status_code == 422
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
    assert "may reserve at most 1000.00" in refused.json()["detail"]
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
    assert (wedding["progress"], wedding["need"]) == ("0.0500", "1628.58")
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


async def test_a_plan_confirmed_now_leaves_past_months_alone(finance_client: AsyncClient) -> None:
    ids = await setup(finance_client)
    before = (await finance_client.get(f"{API}/budget/free", params=TODAY)).json()["mine"]
    await plan(
        finance_client, today="2026-11-02", name="Haftpflicht", account_id=ids["giro"],
        payee_id=ids["payee"], amount="-600.00", tolerance="5.00", every_months=12,
        category_id=ids["insurance"], start="2026-10-01",
    )  # fmt: skip
    after = (await finance_client.get(f"{API}/budget/free", params=TODAY)).json()["mine"]
    assert after == before
    due = (await finance_client.get(f"{API}/plans/upcoming", params={"month": "2026-10"})).json()
    assert due[0]["match"]["timing"] == "on_time"


async def test_a_bill_paid_a_month_late_meets_its_open_date(finance_client: AsyncClient) -> None:
    ids = await setup(finance_client)
    await plan(
        finance_client, name="Haftpflicht", account_id=ids["giro"], payee_id=ids["payee"],
        amount="-600.00", tolerance="5.00", every_months=12, start="2026-09-15",
    )  # fmt: skip
    due = (await finance_client.get(f"{API}/plans/upcoming", params={"month": "2026-09"})).json()
    assert (due[0]["match"]["booking_date"], due[0]["match"]["timing"]) == ("2026-10-04", "late")


async def test_a_salary_after_the_cutoff_counts_for_the_next_month(
    finance_client: AsyncClient,
) -> None:
    ids = await setup(finance_client)
    await finance_client.put(
        f"{API}/budget/settings",
        json={"salary_cutoff_day": 15, "salary_category_ids": [ids["salary"]]},
    )
    await plan(
        finance_client, name="Pay", account_id=ids["giro"], text="Lohn", amount="3000",
        category_id=ids["salary"], start="2026-09-20",
    )  # fmt: skip
    due = (await finance_client.get(f"{API}/plans/upcoming", params={"month": "2026-10"})).json()
    assert due[0]["counts_for"] == "2026-11"


async def saving_goal(client: AsyncClient, ids: dict[str, int], **fields: Any) -> dict[str, Any]:
    await client.post(
        f"{API}/balances",
        json=[{"account_id": ids["saving"], "date": "2026-10-09", "amount": "1000"}],
    )
    body = {"name": "Trip", "target": "2000", "due": "2027-04-01", "account_id": ids["saving"]}
    response = await client.post(f"{API}/goals", json={**body, **fields})
    assert response.status_code == 200, response.text
    return response.json()


async def test_assigning_a_contribution_is_once_a_month_and_undone(
    finance_client: AsyncClient,
) -> None:
    goal = await saving_goal(finance_client, await setup(finance_client), monthly="300")
    assert (goal["target"], goal["monthly"]) == ("2000.00", "300.00")
    url, day = f"{API}/goals/{goal['id']}/assign", {"today": "2026-10-10"}
    first = (await finance_client.post(url, params=day)).json()
    again = (await finance_client.post(url, params=day)).json()
    assert (first["reserved"], first["assigned_month"]) == ("300.00", "2026-10")
    assert again["reserved"] == "300.00"
    undone = (await finance_client.delete(url, params=day)).json()
    assert (undone["reserved"], undone["assigned_month"]) == ("0.00", None)
    assert (await finance_client.delete(url, params=day)).status_code == 409


async def test_a_leftover_moved_into_a_goal_leaves_the_limits_leftover(
    finance_client: AsyncClient,
) -> None:
    ids = await setup(finance_client)
    goal = await saving_goal(finance_client, ids)
    await finance_client.put(
        f"{API}/categories/{ids['insurance']}/limit", json={"amount": "700", "from": "2026-10"}
    )
    month = {"month": "2026-11", "today": "2026-11-02"}
    left = (await finance_client.get(f"{API}/budget", params=month)).json()["unreserved"]
    assert left["total"] == "103.00"
    url = f"{API}/goals/{goal['id']}/leftover"
    too_much = await finance_client.post(
        url, json={"amount": "200"}, params={"today": "2026-11-02"}
    )
    assert too_much.status_code == 422
    moved = await finance_client.post(url, json={"amount": "100"}, params={"today": "2026-11-02"})
    assert moved.json()["reserved"] == "100.00"
    left = (await finance_client.get(f"{API}/budget", params=month)).json()["unreserved"]
    assert (left["total"], left["moved"]) == ("3.00", "100.00")


async def test_the_splits_of_a_bill_its_reserve_paid_count_in_no_spending(
    finance_client: AsyncClient,
) -> None:
    ids = await setup(finance_client)
    await plan(
        finance_client, today="2025-11-01", name="Haftpflicht", account_id=ids["giro"],
        payee_id=ids["payee"], amount="-600.00", tolerance="5.00", every_months=12,
        category_id=ids["insurance"], start="2026-10-01",
    )  # fmt: skip
    bill = (await stored(finance_client))["bill"]["id"]
    parts = [{"amount": "-300.00"}, {"amount": "-297.00"}]
    split = await finance_client.put(f"{API}/transactions/{bill}/splits", json=parts)
    for part in split.json()["splits"]:
        await finance_client.put(
            f"{API}/splits/{part['id']}/category", json={"category_id": ids["insurance"]}
        )
    free = (await finance_client.get(f"{API}/budget/free", params=TODAY)).json()["mine"]
    assert free["non_monthly"]["lines"] == []


async def test_a_second_press_makes_no_twin_plan(finance_client: AsyncClient) -> None:
    giro = await own(finance_client, "Giro", GIRO, "giro")
    body: dict[str, Any] = {
        "name": "Rent",
        "account_id": giro,
        "text": "Miete",
        "amount": "-900",
        "start": "2026-10-01",
    }
    await plan(finance_client, **body)
    again = await finance_client.post(f"{API}/plans", json=body, params={"today": "2026-10-10"})
    assert again.status_code == 409


CONTRACTS = "03 Areas/03 Money/Contracts"
HAFTPFLICHT: dict[str, Any] = {
    "name": "Haftpflicht",
    "text": "HUK",
    "amount": "-600.00",
    "every_months": 12,
    "start": "2025-10-04",
}
TERMS = "start: 2024-03-01\nterm: 12 months\nrenews: 12 months\nnotice: 3 months\n"


def contract_note(vault: Path, name: str, fields: str) -> Path:
    note = vault / CONTRACTS / f"{name}.md"
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(f"---\ntype: Contract\n{fields}---\n# {name}\n", encoding="utf-8")
    return note


async def test_a_contract_note_is_made_from_a_plan_once(
    vault: Path, finance_client: AsyncClient
) -> None:
    ids = await setup(finance_client)
    made = await plan(finance_client, **HAFTPFLICHT, account_id=ids["giro"])
    response = await finance_client.post(f"{API}/contracts", json={"plan_id": made["id"]})
    assert response.status_code == 201, response.text
    assert response.json()["path"] == f"{CONTRACTS}/Haftpflicht.md"
    assert response.json()["problem"] == "start missing or unreadable"
    text = (vault / CONTRACTS / "Haftpflicht.md").read_text(encoding="utf-8")
    assert f"type: Contract\nplan: {made['id']}\nstart:\nterm:\nrenews:\nnotice:\n" in text
    assert f"Plan {made['id']} in kasten: Haftpflicht, -600.00 € every 12 months." in text
    again = await finance_client.post(f"{API}/contracts", json={"plan_id": made["id"]})
    assert again.status_code == 409
    gone = await finance_client.post(f"{API}/contracts", json={"plan_id": made["id"] + 999})
    assert gone.status_code == 404


async def test_contracts_list_by_cancel_by_with_cost_a_year_and_what_is_wrong(
    vault: Path, finance_client: AsyncClient
) -> None:
    ids = await setup(finance_client)
    made = await plan(finance_client, **HAFTPFLICHT, account_id=ids["giro"])
    contract_note(vault, "Haftpflicht", f"plan: {made['id']}\n{TERMS}")
    contract_note(vault, "Gym", TERMS.replace("2024-03-01", "2024-01-15"))
    contract_note(vault, "Phone", f"plan: {made['id'] + 999}\n{TERMS}")
    contract_note(vault, "Paper", "start: 2024-03-01\n")
    contract_note(vault, "Fax", f"plan: {made['id'] + 999}\nstart: 2024-03-01\n")
    (vault / CONTRACTS / "Notes.md").write_text("# not a contract\n", encoding="utf-8")
    response = await finance_client.get(f"{API}/contracts", params={"today": "2026-10-10"})
    assert response.status_code == 200, response.text
    found = response.json()
    rows = [
        (c["name"], c["cancel_by"], c["renews"], c["yearly"], c["problem"])
        for c in found["contracts"]
    ]
    assert rows == [
        ("Gym", "2026-10-14", "2027-01-15", None, None),
        ("Haftpflicht", "2026-11-28", "2027-03-01", "600.00", None),
        ("Phone", "2026-11-28", "2027-03-01", None, f"plan {made['id'] + 999} is gone"),
        ("Fax", None, None, None, f"plan {made['id'] + 999} is gone; term missing or unreadable"),
        ("Paper", None, None, None, "term missing or unreadable"),
    ]
    assert found["contracts"][1]["plan_name"] == "Haftpflicht"
    assert found["contracts"][1]["amount"] == "-600.00"
    assert found["yearly"] == "600.00"


async def test_reminders_write_each_cancel_by_todo_once(vault: Path, client: AsyncClient) -> None:
    note = contract_note(vault, "Gym", TERMS)
    contract_note(vault, "Paper", "start: 2024-03-01\n")
    params = {"today": "2026-10-10"}
    first = await client.post(f"{API}/contracts/reminders", params=params)
    assert first.json() == [f"{CONTRACTS}/Gym.md"]
    text = note.read_text(encoding="utf-8")
    assert text.endswith(
        "## Cancel-by\n- [ ] cancel or renegotiate Gym, renews 2027-03-01"
        " 📅 2026-11-28 ⏳ 2026-10-31\n"
    )
    assert "\nid: " in text
    assert (await client.post(f"{API}/contracts/reminders", params=params)).json() == []
    note.write_text(text.replace("- [ ]", "- [x]"), encoding="utf-8")
    assert (await client.post(f"{API}/contracts/reminders", params=params)).json() == [
        f"{CONTRACTS}/Gym.md"
    ]
    assert "📅 2027-11-29 ⏳ 2027-11-01\n" in note.read_text(encoding="utf-8")


async def rising_gym(client: AsyncClient, vault: Path, giro: int) -> dict[str, Any]:
    """A plan of -39.00 to the cent, paid -44.00 in September and October, and its contract."""
    await post(
        client,
        [
            booking(giro, f"gym{n}", "-44.00", booking_date=day, counterparty_name="Fitness")
            for n, day in enumerate(["2026-09-05", "2026-10-05"])
        ],
    )
    gym: dict[str, Any] = {"name": "Gym", "account_id": giro, "text": "fitness", "tolerance": "0"}
    made = await plan(client, **gym, amount="-39.00", start="2026-09-05")
    contract_note(vault, "Gym", f"plan: {made['id']}\n{TERMS}")
    return gym


async def test_1679_contracts_flag_a_price_rise_unless_another_plan_holds_its_bookings(
    vault: Path, finance_client: AsyncClient
) -> None:
    gym = await rising_gym(finance_client, vault, await own(finance_client, "Giro", GIRO, "giro"))
    day = {"today": "2026-10-10"}
    found = (await finance_client.get(f"{API}/contracts", params=day)).json()
    assert found["contracts"][0]["rise"] == {"old": "-39.00", "new": "-44.00"}
    await plan(finance_client, **{**gym, "name": "Gym plus"}, amount="-44.00", start="2026-09-05")
    found = (await finance_client.get(f"{API}/contracts", params=day)).json()
    assert found["contracts"][0]["rise"] is None
