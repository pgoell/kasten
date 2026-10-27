"""What an agent token's requests leave behind: one row each, read back through the token's name.

The rows live in the scratch database from the `activity` fixture, so each test
starts with none. Observed through HTTP and raw SQL only: the rows are the
table's, and the answers are what a token holder and the browser see.
"""

import asyncio
import hashlib
import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.tests.test_mcp import ENDPOINT, RPC, call
from kasten_backend import db
from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncEngine

ACTIONS = "/api/tokens/laptop/actions"
"""The recent actions of the token `laptop`, newest first."""

DEAD = "postgresql+psycopg://kasten:kasten@127.0.0.1:1/none"
"""A database no one listens on, so every connect is refused at once."""


def dead_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the app's sessions at a database that answers nothing."""
    engine = create_async_engine(DEAD)
    monkeypatch.setattr(db, "session_factory", async_sessionmaker(engine, expire_on_commit=False))


class Hung:
    """A session whose connect never answers, the way a host that drops packets behaves."""

    async def __aenter__(self) -> None:
        await asyncio.Event().wait()

    async def __aexit__(self, *_exc: object) -> None:
        return None


async def actions(client: AsyncClient) -> list[dict[str, Any]]:
    """The laptop token's recent actions, as the token page reads them."""
    response = await client.get(ACTIONS)
    assert response.status_code == 200, response.text
    return response.json()


async def test_a_request_with_a_token_writes_one_row_and_is_its_last_use(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], activity: AsyncEngine
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")

    await client.get("/agent/notes/borges.md", headers=bearer)

    listed = (await client.get("/api/tokens")).json()
    laptop = next(entry for entry in listed if entry["name"] == "laptop")
    assert laptop["last_used"] is not None
    rows = await actions(client)
    assert len(rows) == 1
    row = rows[0]
    shape = (row["method"], row["path"], row["note"], row["tool"], row["status"], row["outcome"])
    assert shape == ("GET", "/agent/notes/borges.md", "borges.md", None, 200, "ok")


async def test_the_client_is_the_last_forwarded_hop(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], activity: AsyncEngine
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")

    await client.get(
        "/agent/notes/borges.md",
        headers={**bearer, "X-Forwarded-For": "203.0.113.9, 198.51.100.7"},
    )

    rows = await actions(client)
    assert rows[0]["client"] == "198.51.100.7"


async def test_a_revoked_token_writes_a_row_saying_so(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], activity: AsyncEngine
) -> None:
    await client.delete("/api/tokens/laptop")

    refused = await client.get("/agent/notes", headers=bearer)

    assert refused.status_code == 401
    rows = await actions(client)
    assert len(rows) == 1
    assert (rows[0]["status"], rows[0]["outcome"], rows[0]["path"]) == (
        401,
        "revoked",
        "/agent/notes",
    )


async def test_a_revoked_token_on_mcp_writes_a_row_saying_so(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], activity: AsyncEngine
) -> None:
    await client.delete("/api/tokens/laptop")

    refused = await client.post(ENDPOINT, json=call("list_notes", {}), headers={**bearer, **RPC})

    assert refused.status_code == 401
    rows = await actions(client)
    assert len(rows) == 1
    row = rows[0]
    assert (row["status"], row["outcome"], row["path"]) == (401, "revoked", "/agent/mcp")


async def test_rows_older_than_ninety_days_are_dropped(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    activity: AsyncEngine,
) -> None:
    async with activity.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO token_action (at, token, method, path, status, outcome) VALUES "
                "(now() - interval '91 days', 'laptop', 'GET', '/agent/dropped-91', 200, 'ok'), "
                "(now() - interval '89 days', 'laptop', 'GET', '/agent/kept-89', 200, 'ok')"
            )
        )

    await client.get("/agent/notes", headers=bearer)

    rows = await actions(client)
    assert [row["path"] for row in rows] == ["/agent/notes", "/agent/kept-89"]


async def test_an_unknown_bearer_writes_no_row(
    client: AsyncClient, agent_vault: Path, activity: AsyncEngine
) -> None:
    refused = await client.get(
        "/agent/notes", headers={"Authorization": "Bearer kasten_neverissued"}
    )

    assert refused.status_code == 401
    assert await actions(client) == []


async def test_a_failed_insert_leaves_the_answer_and_logs_it(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")
    dead_database(monkeypatch)

    response = await client.get("/agent/notes/borges.md", headers=bearer)

    assert response.status_code == 200
    assert response.json() == {
        "path": "borges.md",
        "content": "# borges\n",
        "sha": hashlib.sha256(b"# borges\n").hexdigest(),
    }
    assert any(
        record.levelno == logging.WARNING and "Could not record" in record.getMessage()
        for record in caplog.records
    )


async def test_a_hung_insert_is_cut_off_and_logged(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")
    monkeypatch.setenv("KASTEN_ACTIVITY_TIMEOUT_SECONDS", "0.2")
    get_settings.cache_clear()
    monkeypatch.setattr(db, "session_factory", Hung)

    response = await client.get("/agent/notes/borges.md", headers=bearer)

    assert response.status_code == 200
    assert any("Could not record" in record.getMessage() for record in caplog.records)


async def test_the_listing_answers_without_a_database(
    client: AsyncClient, token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    created = (await client.get("/api/tokens")).json()[0]["created"]
    dead_database(monkeypatch)

    response = await client.get("/api/tokens")

    assert response.status_code == 200
    assert response.json() == [{"name": "laptop", "created": created, "last_used": None}]


async def test_a_revoked_name_mints_again_and_never_lists(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], activity: AsyncEngine
) -> None:
    await client.delete("/api/tokens/laptop")
    old_refused = await client.get("/agent/notes", headers=bearer)

    minted = await client.post("/api/tokens", json={"name": "laptop"})
    fresh = {"Authorization": f"Bearer {minted.json()['secret']}"}
    new_read = await client.get("/agent/notes", headers=fresh)

    assert minted.status_code == 201
    assert old_refused.status_code == 401
    assert new_read.status_code == 200
    listed = (await client.get("/api/tokens")).json()
    assert [entry["name"] for entry in listed] == ["laptop"]
    rows = await actions(client)
    assert [(row["status"], row["outcome"]) for row in rows] == [(200, "ok"), (401, "revoked")]


async def test_no_row_carries_a_secret_or_a_query(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    token: str,
    activity: AsyncEngine,
) -> None:
    await client.get("/agent/search", params={"q": "zebrasecret"}, headers=bearer)

    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    row_answer = (await client.get(ACTIONS)).text
    listing_answer = (await client.get("/api/tokens")).text
    for answer in (row_answer, listing_answer):
        assert token not in answer
        assert digest not in answer
        assert "zebrasecret" not in answer
    rows = await actions(client)
    assert [row["path"] for row in rows] == ["/agent/search"]
