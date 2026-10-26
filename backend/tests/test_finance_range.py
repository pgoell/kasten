"""The span routes, the span on the flow and drilldowns, and the budget setup, on a database.

Skipped without one; see the `finance_session` fixture. The rules are tested
without a database in test_finance_range_model.py.
"""

from typing import TYPE_CHECKING

from backend.tests.finance_rows import API, booking, post
from backend.tests.test_finance_drill import settled

if TYPE_CHECKING:
    from httpx import AsyncClient

SPAN = {"from": "2026-09", "month": "2026-10"}


async def test_a_span_reads_both_scopes_as_the_spans_sankey_does(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    # A second salary, booked after the cutoff in October, counts for November: outside the span.
    await post(
        finance_client,
        [booking(ids["giro"], "pay2", "3000.00", booking_date="2026-10-20", purpose="Lohn")],
    )
    rows = (await finance_client.get(f"{API}/transactions")).json()
    pay2 = next(row for row in rows if row["source_key"] == "pay2")
    await finance_client.put(
        f"{API}/transactions/{pay2['id']}/category", json={"category_id": ids["salary"]}
    )

    found = (await finance_client.get(f"{API}/budget/range", params=SPAN)).json()
    flow = (await finance_client.get(f"{API}/budget/flow", params=SPAN)).json()
    names = {node["key"]: node["name"] for node in flow["nodes"]}
    streams = {(names[x["source"]], names[x["target"]]): x["amount"] for x in flow["links"]}

    assert (found["first"], found["month"], found["months"]) == ("2026-09", "2026-10", 2)
    mine = found["mine"]["now"]
    assert mine["income"] == streams["Salary", "Mine"] == "3000.00"
    assert mine["other_scope"] == streams["Mine", "Into household"] == "900.00"
    assert mine["left"] == streams["Mine", "Left over"] == "1680.00"
    assert found["mine"]["last_year"]["income"] == "0.00"
    assert flow["first"] == "2026-09"


async def test_a_span_that_ends_before_it_starts_is_a_422(finance_client: AsyncClient) -> None:
    backwards = {"from": "2026-11", "month": "2026-10"}
    for path in ("budget/range", "budget/flow", "drill/scopes/mine"):
        response = await finance_client.get(f"{API}/{path}", params=backwards)
        assert response.status_code == 422, path


async def test_a_drilldown_over_a_span_lists_the_spans_bookings_and_compares_it(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    scope = (await finance_client.get(f"{API}/drill/scopes/mine", params=SPAN)).json()
    assert scope["first"] == "2026-09"
    assert scope["span"]["now"]["left"] == "1680.00"
    assert {row["source_key"] for row in scope["bookings"]} == {"pay", "out", "save", "food"}

    category = (
        await finance_client.get(f"{API}/drill/categories/{ids['groceries']}", params=SPAN)
    ).json()
    assert category["span"]["now"]["total"] == "120.00"
    assert category["span"]["available"] is None


async def test_the_setup_lists_every_spending_category_against_the_expected_income(
    finance_client: AsyncClient,
) -> None:
    await settled(finance_client)
    found = (
        await finance_client.get(
            f"{API}/budget/setup", params={"month": "2026-10", "today": "2026-10-10"}
        )
    ).json()
    # The salary and the household contribution; household's money from mine is mine's own.
    assert found["expected_income"] == "3800.00"
    assert [c["name"] for c in found["categories"]] == ["Rent", "Groceries"]
    assert found["limits"] == "0.00"


async def test_setting_every_limit_at_once_writes_all_or_none(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    refused = await finance_client.put(
        f"{API}/budget/limits",
        json={
            "from": "2026-10",
            "limits": [
                {"category_id": ids["groceries"], "amount": "400"},
                {"category_id": ids["salary"], "amount": "10"},
            ],
        },
    )
    assert refused.status_code == 422
    budget = {"month": "2026-10", "today": "2026-10-10"}
    rows = (await finance_client.get(f"{API}/budget", params=budget)).json()["categories"]
    assert all(row["limit"] is None for row in rows)

    written = await finance_client.put(
        f"{API}/budget/limits",
        json={
            "from": "2026-10",
            "limits": [
                {"category_id": ids["groceries"], "amount": "400"},
                {"category_id": ids["rent"], "amount": "1500"},
            ],
        },
    )
    assert written.status_code == 200, written.text
    rows = (await finance_client.get(f"{API}/budget", params=budget)).json()["categories"]
    assert {row["name"]: row["limit"] for row in rows} == {"Groceries": "400.00", "Rent": "1500.00"}
    september = {"month": "2026-09", "today": "2026-10-10"}
    rows = (await finance_client.get(f"{API}/budget", params=september)).json()["categories"]
    assert all(row["limit"] is None for row in rows)
