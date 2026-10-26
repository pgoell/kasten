"""The finance reads an agent has: the same figures as the pane, single bookings, nothing written.

Through `/agent/finance/*` and the MCP tools on a migrated database, skipped
without one; see the `finance_session` fixture. Each summary is checked equal
to the pane's own route for the same month, so a rule the budget gets right
(the cutoff, the move into the shared account, a saving) an agent gets right.
"""

from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.tests.finance_rows import API, SAVING
from backend.tests.test_finance_budget import household, own
from backend.tests.test_mcp import ENDPOINT, RPC, call, payload
from kasten_backend import agent_finance, agent_mcp_finance, db

if TYPE_CHECKING:
    from httpx import AsyncClient

AGENT = "/agent/finance"
OCTOBER = {"month": "2026-10", "today": "2026-10-10"}


async def tool(client: AsyncClient, bearer: dict[str, str], name: str, **arguments: Any) -> Any:
    """What one MCP tool call answers: its content, or the error text when it refused."""
    response = await client.post(ENDPOINT, json=call(name, arguments), headers={**bearer, **RPC})
    result = payload(response.text)["result"]
    if result.get("isError"):
        return result["content"][0]["text"]
    return result["structuredContent"]


async def month(client: AsyncClient) -> dict[str, int]:
    """October's household money, the salary cutoff on the 15th, a goal, a plan and a pull asked."""
    ids = await household(client)
    await client.put(
        f"{API}/budget/settings",
        json={"salary_cutoff_day": 15, "salary_category_ids": [ids["salary"]]},
    )
    saving = await own(client, "Saving", SAVING, "saving")
    await client.post(
        f"{API}/balances", json=[{"account_id": saving, "date": "2026-10-09", "amount": "1000"}]
    )
    goal = {"name": "Trip", "target": "2000", "due": "2027-04-01", "account_id": saving}
    made = await client.post(f"{API}/goals", json={**goal, "reserved": "300", "monthly": "100"})
    assert made.status_code == 200, made.text
    rent = {
        "name": "Rent", "account_id": ids["giro"], "text": "Miete", "amount": "-900",
        "start": "2026-10-01",
    }  # fmt: skip
    planned = await client.post(f"{API}/plans", json=rent, params={"today": "2026-10-10"})
    assert planned.status_code == 200, planned.text
    assert (await client.post(f"{API}/sync/requests")).status_code < 300
    return {**ids, "saving": saving}


@pytest.mark.parametrize(
    ("route", "params", "name", "arguments"),
    [
        ("/budget", OCTOBER, "monthly_by_category", OCTOBER),
        ("/budget/free", OCTOBER, "free_to_spend", OCTOBER),
        ("/goals", {"today": "2026-10-10"}, "goal_progress", {"today": "2026-10-10"}),
        ("/sync", {}, "sync_status", {}),
    ],
)
async def test_each_summary_is_the_panes_own_figure(  # noqa: PLR0913, PLR0917  one fixture each
    finance_client: AsyncClient,
    bearer: dict[str, str],
    route: str,
    params: dict[str, str],
    name: str,
    arguments: dict[str, str],
) -> None:
    await month(finance_client)

    pane = (await finance_client.get(f"{API}{route}", params=params)).json()
    agent = await finance_client.get(f"{AGENT}{route}", params=params, headers=bearer)

    assert agent.status_code == 200, agent.text
    assert agent.json() == pane
    assert await tool(finance_client, bearer, name, **arguments) == pane


async def test_free_to_spend_counts_the_shared_move_once_and_the_late_salary_in_october(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    await month(finance_client)

    free = await tool(finance_client, bearer, "free_to_spend", **OCTOBER)

    # The salary of 20 September counts for October, past the cutoff on the
    # 15th; the 900 into the shared account is a fixed cost on mine and income
    # on household; the 300 moved into saving covers the goal's 100.
    assert free["mine"]["income"]["total"] == "3000.00"
    assert free["mine"]["fixed"]["total"] == "900.00"
    assert free["mine"]["saved"] == "300.00"
    assert free["mine"]["goals"]["total"] == "0.00"
    assert free["household"]["income"]["total"] == "1700.00"


async def test_the_forecast_tool_is_the_plans_tab(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    await month(finance_client)

    found = await tool(finance_client, bearer, "plan_forecast", today="2026-10-10")

    today = {"today": "2026-10-10"}
    assert (
        found["forecast"]
        == (await finance_client.get(f"{API}/plans/forecast", params=today)).json()
    )
    upcoming = (
        await finance_client.get(f"{API}/plans/upcoming", params={"month": "2026-10"})
    ).json()
    assert found["upcoming"] == upcoming
    assert [due["name"] for due in upcoming] == ["Rent"]


async def test_a_booking_reads_whole_as_the_drilldown_has_it(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    await month(finance_client)
    rows = (await finance_client.get(f"{API}/transactions")).json()
    rent = next(row["id"] for row in rows if row["purpose"] == "Miete")

    pane = (await finance_client.get(f"{API}/drill/bookings/{rent}")).json()
    agent = await finance_client.get(f"{AGENT}/transactions/{rent}", headers=bearer)

    assert agent.json() == pane
    assert await tool(finance_client, bearer, "read_transaction", transaction_id=rent) == pane
    assert [(c["scope"], c["amount"]) for c in pane["counts"]] == [("household", "1500.00")]
    missing = await tool(finance_client, bearer, "read_transaction", transaction_id=rent + 999)
    assert missing.endswith("No such transaction")


async def purposes(client: AsyncClient, bearer: dict[str, str], **arguments: Any) -> list[str]:
    page = await tool(client, bearer, "list_transactions", **arguments)
    return [row["purpose"] for row in page["bookings"]]


async def test_a_scope_lists_its_own_accounts_and_no_saving_account(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    await month(finance_client)

    mine = await purposes(finance_client, bearer, scope="mine", oldest_first=True)
    shared = await purposes(finance_client, bearer, scope="household", month="2026-10")

    # The booking into the saving account is on neither scope.
    assert mine == ["Lohn", "Bäckerei", "Bäckerei", "Rewe"]
    assert sorted(shared) == ["Bäckerei", "Haushalt", "Miete"]


async def test_the_filters_narrow_by_text_category_and_booking_date(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    ids = await month(finance_client)

    assert await purposes(finance_client, bearer, text="rewe") == ["Rewe"]
    assert await purposes(finance_client, bearer, category=ids["rent"]) == ["Miete"]
    # By booking date: the salary of 20 September is not October's here.
    assert "Lohn" not in await purposes(finance_client, bearer, month="2026-10")
    september = await purposes(finance_client, bearer, start="2026-09-01", end="2026-09-30")
    assert september == ["Lohn"]
    refused = await tool(
        finance_client, bearer, "list_transactions", month="2026-10", start="2026-10-01"
    )
    assert refused.endswith("`month` comes without `start` and `end`")
    backwards = await tool(
        finance_client, bearer, "list_transactions", start="2026-10-02", end="2026-10-01"
    )
    assert backwards.endswith("`start` is after `end`")


async def test_pages_follow_one_another_and_carry_no_raw_record(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    await month(finance_client)

    first = await tool(finance_client, bearer, "list_transactions", limit=5)
    rest = await tool(finance_client, bearer, "list_transactions", limit=5, after=first["next"])
    every = (await finance_client.get(f"{API}/transactions", params={"order": "desc"})).json()

    assert first["next"] is not None
    assert rest["next"] is None
    assert [r["id"] for r in first["bookings"] + rest["bookings"]] == [r["id"] for r in every]
    assert "raw" not in first["bookings"][0]
    route = await finance_client.get(f"{AGENT}/transactions", params={"limit": 5}, headers=bearer)
    assert route.json() == first
    too_many = await finance_client.get(
        f"{AGENT}/transactions", params={"limit": 501}, headers=bearer
    )
    assert too_many.status_code == 422


async def test_the_lookup_names_every_id(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    ids = await month(finance_client)

    found = await tool(finance_client, bearer, "finance_lookup")

    assert {a["name"] for a in found["accounts"]} == {"Giro", "Shared", "Saving"}
    assert {c["id"] for c in found["categories"]} >= {ids["rent"], ids["groceries"]}
    assert found == (await finance_client.get(f"{AGENT}/lookup", headers=bearer)).json()


async def test_no_token_reads_no_finance(finance_client: AsyncClient) -> None:
    assert (await finance_client.get(f"{AGENT}/sync")).status_code == 401


async def test_the_agent_writes_nothing_to_finance(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    schema = (await finance_client.get("/agent/openapi.json", headers=bearer)).json()
    finance = {path: ops for path, ops in schema["paths"].items() if "/finance/" in path}

    assert len(finance) == 9
    assert {method for ops in finance.values() for method in ops} == {"get"}
    post_attempt = await finance_client.post(f"{AGENT}/transactions", json=[], headers=bearer)
    # Past the routes to the MCP mount, which has no such path either.
    assert post_attempt.status_code == 404


async def test_with_no_database_the_route_and_the_tool_say_so(
    client: AsyncClient, bearer: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # A self-host with no Postgres: nothing listens, and the connect is refused at once.
    nowhere = create_async_engine("postgresql+psycopg://x:x@127.0.0.1:1/x")
    monkeypatch.setattr(db, "session_factory", async_sessionmaker(nowhere))
    monkeypatch.setattr(agent_finance, "sessions", db.get_session)

    route = await client.get(f"{AGENT}/budget/free", params=OCTOBER, headers=bearer)
    said = await tool(client, bearer, "free_to_spend", **OCTOBER)

    assert route.status_code == 503
    assert route.json()["detail"].startswith("No database answers at KASTEN_DATABASE_URL")
    assert said.endswith(route.json()["detail"])
    await nowhere.dispose()


async def test_a_month_that_is_none_is_a_tool_error(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    said = await tool(
        finance_client, bearer, "monthly_by_category", month="2026-13", today="2026-10-10"
    )

    assert said.endswith("`month` must be a real month")


async def test_a_cursor_whose_booking_is_gone_is_refused_rather_than_an_empty_page(
    finance_client: AsyncClient, bearer: dict[str, str]
) -> None:
    await month(finance_client)
    newest = (await tool(finance_client, bearer, "list_transactions"))["bookings"][0]["id"]

    said = await tool(finance_client, bearer, "list_transactions", after=newest + 999)
    route = await finance_client.get(
        f"{AGENT}/transactions", params={"after": newest + 999}, headers=bearer
    )

    assert said.endswith(f"No booking {newest + 999} to page after; start again without it")
    assert route.status_code == 400


async def test_a_database_failure_reaches_the_agent_without_its_sql(
    finance_client: AsyncClient, bearer: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(_session: object) -> None:
        raise ProgrammingError("SELECT iban FROM finance.account", {}, Exception("no table"))

    monkeypatch.setattr(agent_finance, "lookup", broken)

    said = await tool(finance_client, bearer, "finance_lookup")

    assert said.endswith(agent_mcp_finance.UNREADABLE)
    assert "SELECT" not in said
