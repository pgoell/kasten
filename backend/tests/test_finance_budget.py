"""The budget routes: a month's budget, free to spend, the trend, limits and settings.

Through the routes on a migrated database, skipped without one; see the
`finance_session` fixture. The rules themselves are tested without a database
in test_finance_budget_model.py; these check the routes read and write them.
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any

from backend.tests.finance_rows import API, GIRO, SAVING, booking, category, post

if TYPE_CHECKING:
    from httpx import AsyncClient

SHARED = "DE89370400440532013000"
TODAY = {"month": "2026-10", "today": "2026-10-10"}


async def own(client: AsyncClient, name: str, iban: str, kind: str, *, shared: bool = False) -> int:
    response = await client.post(
        f"{API}/accounts", json={"name": name, "iban": iban, "kind": kind, "shared": shared}
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def limit(client: AsyncClient, category_id: int, amount: str | None, start: str) -> Any:
    return await client.put(
        f"{API}/categories/{category_id}/limit", json={"amount": amount, "from": start}
    )


async def household(client: AsyncClient) -> dict[str, int]:
    """Mine, the shared account and a saving account, with October's money in them."""
    giro = await own(client, "Giro", GIRO, "giro")
    shared = await own(client, "Shared", SHARED, "giro", shared=True)
    saving = await own(client, "Saving", SAVING, "saving")
    ids = {
        "giro": giro,
        "salary": await category(client, "Salary", "income"),
        "contribution": await category(client, "Household contribution", "income"),
        "rent": await category(client, "Rent", "fixed"),
        "groceries": await category(client, "Groceries"),
    }
    day = {"booking_date": "2026-10-02"}
    await post(
        client,
        [
            booking(giro, "pay", "3000.00", booking_date="2026-09-20", purpose="Lohn"),
            booking(giro, "out", "-900.00", counterparty_iban=SHARED, **day),
            booking(shared, "in", "900.00", counterparty_iban=GIRO, **day),
            booking(giro, "save", "-300.00", counterparty_iban=SAVING, **day),
            booking(saving, "saved", "300.00", counterparty_iban=GIRO, **day),
            booking(shared, "alicia", "800.00", purpose="Haushalt", **day),
            booking(shared, "rent", "-1500.00", purpose="Miete", **day),
            booking(giro, "food", "-120.00", purpose="Rewe", **day),
        ],
    )
    rows = (await client.get(f"{API}/transactions")).json()
    by_key = {row["source_key"]: row["id"] for row in rows}
    for key, name in [
        ("pay", "salary"),
        ("alicia", "contribution"),
        ("rent", "rent"),
        ("food", "groceries"),
    ]:
        await client.put(
            f"{API}/transactions/{by_key[key]}/category", json={"category_id": ids[name]}
        )
    return ids


async def test_free_to_spend_counts_the_move_into_the_shared_account_once_on_each_side(
    finance_client: AsyncClient,
) -> None:
    ids = await household(finance_client)
    await finance_client.put(
        f"{API}/budget/settings",
        json={"salary_cutoff_day": 15, "salary_category_ids": [ids["salary"]]},
    )

    free = (await finance_client.get(f"{API}/budget/free", params=TODAY)).json()

    mine, shared = free["mine"], free["household"]
    assert [(line["name"], line["counted"]) for line in mine["income"]["lines"]] == [
        ("Salary", "3000.00")
    ]
    assert mine["fixed"]["total"] == "900.00"
    assert mine["saved"] == "300.00"
    assert mine["flexible"]["total"] == "120.00"
    assert mine["total"] == "1680.00"
    assert shared["income"]["total"] == "1700.00"
    assert shared["fixed"]["total"] == "1500.00"
    assert shared["total"] == "200.00"


async def test_the_flow_of_a_month_agrees_with_its_free_to_spend_in_each_scope(
    finance_client: AsyncClient,
) -> None:
    ids = await household(finance_client)
    await finance_client.put(
        f"{API}/budget/settings",
        json={"salary_cutoff_day": 15, "salary_category_ids": [ids["salary"]]},
    )

    flow = (await finance_client.get(f"{API}/budget/flow", params={"month": "2026-10"})).json()
    over = {"month": "2026-10", "today": "2026-11-01"}
    free = (await finance_client.get(f"{API}/budget/free", params=over)).json()

    for scope in ("mine", "household"):
        into = sum(Decimal(link["amount"]) for link in flow["links"] if link["target"] == scope)
        left = [link for link in flow["links"] if link["source"] == scope]
        assert into == sum(Decimal(link["amount"]) for link in left)
        kept = sum(Decimal(link["amount"]) for link in left if link["target"] == "left-over")
        assert kept == Decimal(free[scope]["total"])
    names = {node["key"]: node["name"] for node in flow["nodes"]}
    # The salary of 20 September counts for October, past the cutoff on the 15th.
    assert ("Salary", "Mine", "3000.00") in [
        (names[link["source"]], names[link["target"]], link["amount"]) for link in flow["links"]
    ]
    assert {node["category_id"] for node in flow["nodes"] if node["role"] == "category"} == {
        ids["rent"],
        ids["groceries"],
    }


async def test_a_salary_counts_for_its_own_month_once_the_cutoff_is_after_its_day(
    finance_client: AsyncClient,
) -> None:
    ids = await household(finance_client)
    settings = {"salary_cutoff_day": 25, "salary_category_ids": [ids["salary"]]}
    written = await finance_client.put(f"{API}/budget/settings", json=settings)

    free = (await finance_client.get(f"{API}/budget/free", params=TODAY)).json()

    assert written.json() == settings
    assert (await finance_client.get(f"{API}/budget/settings")).json() == settings
    assert free["mine"]["income"]["lines"][0]["basis"] == "average"


async def test_settings_refuse_a_salary_category_that_is_not_income(
    finance_client: AsyncClient,
) -> None:
    ids = await household(finance_client)
    refused = await finance_client.put(
        f"{API}/budget/settings",
        json={"salary_cutoff_day": 15, "salary_category_ids": [ids["rent"]]},
    )
    assert refused.status_code == 422


async def test_a_limit_keeps_its_history_and_an_overspend_shrinks_the_next_month(
    finance_client: AsyncClient,
) -> None:
    ids = await household(finance_client)
    await limit(finance_client, ids["groceries"], "100.00", "2026-10")
    await limit(finance_client, ids["groceries"], "300.00", "2026-11")
    await limit(finance_client, ids["rent"], "1500.00", "2026-10")

    october = (await finance_client.get(f"{API}/budget", params=TODAY)).json()
    november = (
        await finance_client.get(
            f"{API}/budget", params={"month": "2026-11", "today": "2026-11-01"}
        )
    ).json()

    rows = {row["name"]: row for row in october["categories"]}
    assert rows["Groceries"]["limit"] == "100.00"
    assert rows["Groceries"]["status"] == "over"
    assert rows["Rent"]["status"] == "ok"
    later = {row["name"]: row for row in november["categories"]}
    assert later["Groceries"]["carried"] == "20.00"
    assert later["Groceries"]["available"] == "280.00"
    assert november["unreserved"] == {"last_month": "0.00", "total": "0.00"}


async def test_a_limit_on_no_spending_category_is_a_422_and_on_none_a_404(
    finance_client: AsyncClient,
) -> None:
    ids = await household(finance_client)
    assert (await limit(finance_client, ids["salary"], "10.00", "2026-10")).status_code == 422
    assert (await limit(finance_client, 999_999, "10.00", "2026-10")).status_code == 404
    cleared = await limit(finance_client, ids["rent"], None, "2026-10")
    assert cleared.json() == {"category_id": ids["rent"], "from": "2026-10", "amount": None}


async def test_the_trend_sums_each_month_and_the_limits_in_force(
    finance_client: AsyncClient,
) -> None:
    ids = await household(finance_client)
    await limit(finance_client, ids["groceries"], "200.00", "2026-10")

    trend = (
        await finance_client.get(f"{API}/budget/trend", params={"month": "2026-10", "months": 2})
    ).json()

    assert trend["months"] == ["2026-09", "2026-10"]
    assert trend["totals"] == ["0.00", "1620.00"]
    assert trend["limits"] == [None, "200.00"]
    assert {row["name"] for row in trend["categories"]} == {"Groceries", "Rent"}


async def test_transactions_filter_by_month_category_and_text_newest_first(
    finance_client: AsyncClient,
) -> None:
    ids = await household(finance_client)

    def keys(response: Any) -> list[str]:
        assert response.status_code == 200, response.text
        return [row["source_key"] for row in response.json()]

    url = f"{API}/transactions"
    october = await finance_client.get(url, params={"month": "2026-10", "order": "desc"})
    first = await finance_client.get(url, params={"month": "2026-10", "order": "desc", "limit": 2})
    rest = await finance_client.get(
        url, params={"month": "2026-10", "order": "desc", "after": first.json()[-1]["id"]}
    )
    food = await finance_client.get(url, params={"category": ids["groceries"]})
    text = await finance_client.get(url, params={"text": "MIET"})
    both = await finance_client.get(url, params={"month": "2026-10", "from": "2026-10-01"})

    assert keys(october)[:2] == keys(first)
    assert keys(first) + keys(rest) == keys(october)
    assert "pay" not in keys(october)
    assert keys(food) == ["food"]
    assert keys(text) == ["rent"]
    assert both.status_code == 400


async def test_a_transfer_whose_twin_is_not_in_yet_counts_once_by_the_iban_it_names(
    finance_client: AsyncClient,
) -> None:
    await own(finance_client, "Giro", GIRO, "giro")
    await own(finance_client, "Shared", SHARED, "giro", shared=True)
    giro = (await finance_client.get(f"{API}/accounts")).json()[0]["id"]
    await post(
        finance_client,
        [booking(giro, "half", "-900.00", booking_date="2026-10-02", counterparty_iban=SHARED)],
    )

    free = (await finance_client.get(f"{API}/budget/free", params=TODAY)).json()

    assert free["mine"]["unsorted"] == "0.00"
    assert [(line["name"], line["so_far"]) for line in free["mine"]["fixed"]["lines"]] == [
        ("Into the shared account", "900.00")
    ]


async def test_a_rule_on_both_sides_refuses_a_pattern_another_rule_sorts_on_one(
    finance_client: AsyncClient,
) -> None:
    shopping = await category(finance_client, "Shopping")
    refunds = await category(finance_client, "Refunds", "income")
    ignored = await category(finance_client, "Reimbursement", "ignore")
    rules = f"{API}/rules"
    await finance_client.post(
        rules, json={"kind": "text_contains", "pattern": "hotel", "category_id": shopping}
    )
    both = await finance_client.post(
        rules, json={"kind": "text_contains", "pattern": "hotel", "category_id": ignored}
    )
    other = await finance_client.post(
        rules, json={"kind": "text_contains", "pattern": "hotel", "category_id": refunds}
    )
    flipped = await finance_client.put(
        f"{API}/categories/{refunds}", json={"name": "Refunds", "kind": "ignore"}
    )

    assert both.status_code == 409
    assert other.status_code == 200
    assert flipped.status_code == 409
