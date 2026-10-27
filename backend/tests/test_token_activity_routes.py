"""Every route under `/agent/` leaves one row: method, path, note and answer.

The vault routes and the finance reads both. The path is the URL without its
query string. The note is the path the URL names for a note or a file, or none
for a route that names no path of its own.
"""

from typing import TYPE_CHECKING, Any

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncEngine

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
"""A PNG signature and a little padding: the vault checks the first bytes only."""


@pytest.mark.parametrize(
    ("method", "url", "kwargs", "expected"),
    [
        pytest.param(
            "GET",
            "/agent/notes/borges.md",
            {},
            ("/agent/notes/borges.md", "borges.md", 200, "ok"),
            id="read_note",
        ),
        pytest.param("GET", "/agent/notes", {}, ("/agent/notes", None, 200, "ok"), id="list_notes"),
        pytest.param(
            "GET",
            "/agent/search?q=borges",
            {},
            ("/agent/search", None, 200, "ok"),
            id="search",
        ),
        pytest.param("GET", "/agent/graph", {}, ("/agent/graph", None, 200, "ok"), id="graph"),
        pytest.param(
            "GET",
            "/agent/openapi.json",
            {},
            ("/agent/openapi.json", None, 200, "ok"),
            id="openapi",
        ),
        pytest.param(
            "PUT",
            "/agent/notes/new.md",
            {"json": {"content": "# new\n"}},
            ("/agent/notes/new.md", "new.md", 200, "ok"),
            id="save_note",
        ),
        pytest.param(
            "POST",
            "/agent/notes/journal.md/append",
            {"json": {"text": "a line"}},
            ("/agent/notes/journal.md/append", "journal.md", 200, "ok"),
            id="append_note",
        ),
        pytest.param(
            "POST",
            "/agent/dump",
            {"json": {"text": "a thought", "date": "2026-10-27"}},
            ("/agent/dump", None, 200, "ok"),
            id="dump",
        ),
        pytest.param(
            "POST",
            "/agent/files/x.pdf/fetch",
            {"json": {"url": "http://127.0.0.1/x.pdf"}},
            ("/agent/files/x.pdf/fetch", "x.pdf", 400, "error"),
            id="fetch_file",
        ),
        pytest.param(
            "POST",
            "/agent/files/pic.png",
            {"content": PNG},
            ("/agent/files/pic.png", "pic.png", 201, "ok"),
            id="upload_file",
        ),
        pytest.param(
            "GET",
            "/agent/finance/budget?month=2026-10&today=2026-10-10",
            {},
            ("/agent/finance/budget", None, 200, "ok"),
            id="finance_budget",
        ),
        pytest.param(
            "GET",
            "/agent/finance/budget/free?month=2026-10&today=2026-10-10",
            {},
            ("/agent/finance/budget/free", None, 200, "ok"),
            id="finance_free_to_spend",
        ),
        pytest.param(
            "GET",
            "/agent/finance/goals?today=2026-10-10",
            {},
            ("/agent/finance/goals", None, 200, "ok"),
            id="finance_goals",
        ),
        pytest.param(
            "GET",
            "/agent/finance/plans/forecast?today=2026-10-10",
            {},
            ("/agent/finance/plans/forecast", None, 200, "ok"),
            id="finance_forecast",
        ),
        pytest.param(
            "GET",
            "/agent/finance/plans/upcoming?month=2026-10",
            {},
            ("/agent/finance/plans/upcoming", None, 200, "ok"),
            id="finance_upcoming",
        ),
        pytest.param(
            "GET",
            "/agent/finance/sync",
            {},
            ("/agent/finance/sync", None, 200, "ok"),
            id="finance_sync",
        ),
        pytest.param(
            "GET",
            "/agent/finance/tax/2026",
            {},
            ("/agent/finance/tax/2026", None, 200, "ok"),
            id="finance_tax",
        ),
        pytest.param(
            "GET",
            "/agent/finance/transactions/1",
            {},
            ("/agent/finance/transactions/1", None, 404, "error"),
            id="finance_transaction",
        ),
        pytest.param(
            "GET",
            "/agent/finance/lookup",
            {},
            ("/agent/finance/lookup", None, 200, "ok"),
            id="finance_lookup",
        ),
        pytest.param(
            "GET",
            "/agent/finance/transactions",
            {},
            ("/agent/finance/transactions", None, 200, "ok"),
            id="finance_transactions",
        ),
    ],
)
async def test_each_agent_route_writes_one_row(  # noqa: PLR0913, PLR0917  one fixture each
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    activity: AsyncEngine,
    method: str,
    url: str,
    kwargs: dict[str, Any],
    expected: tuple[str, str | None, int, str],
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")

    answer = await client.request(method, url, headers=bearer, **kwargs)

    path, note, status, outcome = expected
    assert answer.status_code == status, answer.text
    rows = (await client.get("/api/tokens/laptop/actions")).json()
    assert len(rows) == 1
    row = rows[0]
    assert (row["method"], row["path"], row["note"], row["status"], row["outcome"]) == (
        method,
        path,
        note,
        status,
        outcome,
    )
