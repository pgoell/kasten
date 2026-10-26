"""The drilldown routes, through the routes on a migrated database, skipped without one.

The figures are tested without a database in test_finance_drill_model.py;
these check the routes read the same bookings the overview and the sankey
read, and list the bookings of the budget month, the salary cutoff included.
"""

from typing import TYPE_CHECKING, Any

from backend.tests.finance_rows import API, booking, post
from backend.tests.test_finance_budget import household

if TYPE_CHECKING:
    from httpx import AsyncClient

OCTOBER = {"month": "2026-10", "months": 2}


async def settled(client: AsyncClient) -> dict[str, int]:
    """The household of test_finance_budget.py with Salary marked as salary, cut off on the 15th."""
    ids = await household(client)
    await client.put(
        f"{API}/budget/settings",
        json={"salary_cutoff_day": 15, "salary_category_ids": [ids["salary"]]},
    )
    return ids


async def by_key(client: AsyncClient) -> dict[str, dict[str, Any]]:
    rows = (await client.get(f"{API}/transactions")).json()
    return {row["source_key"]: row for row in rows}


async def test_a_scope_drill_is_the_sankeys_month_and_lists_the_salary_it_counts(
    finance_client: AsyncClient,
) -> None:
    await settled(finance_client)
    mine = (await finance_client.get(f"{API}/drill/scopes/mine", params=OCTOBER)).json()
    flow = (await finance_client.get(f"{API}/budget/flow", params={"month": "2026-10"})).json()
    names = {node["key"]: node["name"] for node in flow["nodes"]}
    streams = {(names[x["source"]], names[x["target"]]): x["amount"] for x in flow["links"]}

    september, october = mine["months"]
    assert september["income"] == "0.00"
    assert october["income"] == streams["Salary", "Mine"] == "3000.00"
    assert october["other_scope"] == streams["Mine", "Into household"] == "900.00"
    assert october["saved"] == streams["Mine", "Saved"] == "300.00"
    assert october["flexible"] == "120.00"
    assert october["left"] == streams["Mine", "Left over"] == "1680.00"
    # The salary booked on 20 September is October's, and the saving account is in no scope.
    keys = {row["source_key"] for row in mine["bookings"]}
    assert keys == {"pay", "out", "save", "food"}
    assert [a["name"] for a in mine["accounts"]] == ["Giro"]

    shared = (await finance_client.get(f"{API}/drill/scopes/household", params=OCTOBER)).json()
    assert shared["months"][-1]["other_scope"] == "900.00"
    assert {row["source_key"] for row in shared["bookings"]} == {"in", "alicia", "rent"}


async def test_a_category_drill_counts_a_split_part_and_its_payees_add_up(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    await post(
        finance_client,
        [
            booking(
                ids["giro"], "rewe", "-100.00", booking_date="2026-10-05", counterparty_name="REWE"
            ),
        ],
    )
    rewe = (await by_key(finance_client))["rewe"]
    split = await finance_client.put(
        f"{API}/transactions/{rewe['id']}/splits",
        json=[{"amount": "-70.00", "text": "food"}, {"amount": "-30.00", "text": "rent share"}],
    )
    parts = split.json()["splits"]
    for part, name in zip(parts, ("groceries", "rent"), strict=True):
        await finance_client.put(
            f"{API}/splits/{part['id']}/category", json={"category_id": ids[name]}
        )

    found = (
        await finance_client.get(f"{API}/drill/categories/{ids['groceries']}", params=OCTOBER)
    ).json()
    budget = (
        await finance_client.get(
            f"{API}/budget", params={"month": "2026-10", "today": "2026-10-10"}
        )
    ).json()
    groceries = next(row for row in budget["categories"] if row["id"] == ids["groceries"])

    assert found["months"][-1]["total"] == groceries["spent"] == "190.00"
    assert {p["name"]: p["amount"] for p in found["payees"]} == {
        "REWE": "70.00",
        "No payee": "120.00",
    }
    assert {row["source_key"] for row in found["bookings"]} == {"rewe", "food"}

    payee = rewe["payee_id"]
    view = (await finance_client.get(f"{API}/drill/payees/{payee}", params=OCTOBER)).json()
    assert view["months"][-1]["spent"] == "100.00"
    assert view["months"][-1]["bookings"] == 1
    assert {c["name"]: c["amount"] for c in view["categories"]} == {
        "Groceries": "70.00",
        "Rent": "30.00",
    }


async def test_an_account_drill_walks_its_balance_and_keeps_transfers_apart(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    await finance_client.post(
        f"{API}/balances",
        json=[{"account_id": ids["giro"], "date": "2026-10-02", "amount": "1680.00"}],
    )
    found = (await finance_client.get(f"{API}/drill/accounts/{ids['giro']}", params=OCTOBER)).json()

    september, october = found["months"]
    # 1680 on 2 October holds the day's bookings; September ends before them.
    assert october["balance"] == "1680.00"
    assert september["balance"] == "3000.00"
    assert october["money_out"] == "1320.00"
    assert found["scope"] == "mine"
    assert {t["name"]: t["amount"] for t in found["transfers"]} == {
        "Shared": "-900.00",
        "Saving": "-300.00",
    }
    # By booking date: the salary of 20 September is September's here.
    assert {c["name"]: c["amount"] for c in found["categories"]} == {"Groceries": "-120.00"}
    assert {row["source_key"] for row in found["bookings"]} == {"out", "save", "food"}


async def test_a_booking_drill_says_where_it_counts_and_finds_its_twin(
    finance_client: AsyncClient,
) -> None:
    await settled(finance_client)
    rows = await by_key(finance_client)

    out = (await finance_client.get(f"{API}/drill/bookings/{rows['out']['id']}")).json()
    assert out["twin"]["source_key"] == "in"
    assert [(c["scope"], c["part"], c["amount"]) for c in out["counts"]] == [
        ("mine", "other_scope", "900.00")
    ]
    pay = (await finance_client.get(f"{API}/drill/bookings/{rows['pay']['id']}")).json()
    assert [(c["month"], c["part"]) for c in pay["counts"]] == [("2026-10", "income")]
    assert pay["transaction"]["purpose"] == "Lohn"
    assert pay["account"]["name"] == "Giro"


async def test_a_drill_into_nothing_is_a_404(finance_client: AsyncClient) -> None:
    for path in ("categories/0", "payees/0", "accounts/0"):
        response = await finance_client.get(f"{API}/drill/{path}", params=OCTOBER)
        assert response.status_code == 404, path
    assert (await finance_client.get(f"{API}/drill/bookings/0")).status_code == 404
    assert (
        await finance_client.get(f"{API}/drill/scopes/theirs", params=OCTOBER)
    ).status_code == 422
