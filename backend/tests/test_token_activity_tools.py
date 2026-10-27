"""Every MCP tool a token calls leaves one row, naming the tool and the note it touched.

One case per tool, plus a read of a note that is not there, which the tool
answers as an error rather than a refusal of the request. The answer is a 200
either way, so the outcome is what tells a failed tool call from a good one.
"""

from typing import TYPE_CHECKING, Any

import pytest

from backend.tests.test_mcp import ENDPOINT, RPC, call

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncEngine

TODAY = {"today": "2026-10-10"}
OCTOBER = {"month": "2026-10", "today": "2026-10-10"}


@pytest.mark.parametrize(
    ("tool", "arguments", "note", "outcome"),
    [
        pytest.param("list_notes", {}, None, "ok", id="list_notes"),
        pytest.param("read_note", {"path": "borges.md"}, "borges.md", "ok", id="read_note"),
        pytest.param("search_notes", {"query": "borges"}, None, "ok", id="search_notes"),
        pytest.param("query_graph", {}, None, "ok", id="query_graph"),
        pytest.param(
            "save_note",
            {"path": "new.md", "content": "# new\n"},
            "new.md",
            "ok",
            id="save_note",
        ),
        pytest.param(
            "append_note",
            {"path": "journal.md", "text": "a line"},
            "journal.md",
            "ok",
            id="append_note",
        ),
        pytest.param("dump", {"text": "a thought", "date": "2026-10-27"}, None, "ok", id="dump"),
        pytest.param(
            "save_file",
            {"path": "x.pdf", "url": "http://127.0.0.1/x.pdf"},
            "x.pdf",
            "error",
            id="save_file",
        ),
        pytest.param("read_guide", {}, None, "ok", id="read_guide"),
        pytest.param("free_to_spend", OCTOBER, None, "ok", id="free_to_spend"),
        pytest.param("monthly_by_category", OCTOBER, None, "ok", id="monthly_by_category"),
        pytest.param("goal_progress", TODAY, None, "ok", id="goal_progress"),
        pytest.param("plan_forecast", TODAY, None, "ok", id="plan_forecast"),
        pytest.param("sync_status", {}, None, "ok", id="sync_status"),
        pytest.param("tax_year_summary", {"year": 2026}, None, "ok", id="tax_year_summary"),
        pytest.param("list_transactions", {}, None, "ok", id="list_transactions"),
        pytest.param(
            "read_transaction", {"transaction_id": 1}, None, "error", id="read_transaction"
        ),
        pytest.param("finance_lookup", {}, None, "ok", id="finance_lookup"),
        pytest.param(
            "read_note", {"path": "absent.md"}, "absent.md", "error", id="read_note_missing"
        ),
    ],
)
async def test_each_mcp_tool_writes_one_row(  # noqa: PLR0913, PLR0917  one fixture each
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    activity: AsyncEngine,
    tool: str,
    arguments: dict[str, Any],
    note: str | None,
    outcome: str,
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")

    answer = await client.post(ENDPOINT, json=call(tool, arguments), headers={**bearer, **RPC})

    assert answer.status_code == 200
    rows = (await client.get("/api/tokens/laptop/actions")).json()
    assert len(rows) == 1
    row = rows[0]
    shape = (row["tool"], row["method"], row["path"], row["note"], row["status"], row["outcome"])
    assert shape == (tool, "POST", "/agent/mcp", note, 200, outcome)
