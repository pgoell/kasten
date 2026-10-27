"""The gate in front of `/agent/`, which is the whole trust boundary.

One Caddy block carries this prefix to the open internet with no `oauth2_auth`
in front of it, so every case below is the difference between a stranger and the
vault.
"""

import json
import logging
from typing import TYPE_CHECKING

import pytest

from kasten_backend import tokens
from kasten_backend.config import get_settings
from kasten_backend.tokens import revoke

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_no_header_is_refused(client: AsyncClient, agent_vault: Path) -> None:
    (agent_vault / "index.md").write_text("# index")

    response = await client.get("/agent/notes/index.md")

    assert response.status_code == 401


async def test_a_basic_header_is_refused(client: AsyncClient, agent_vault: Path) -> None:
    (agent_vault / "index.md").write_text("# index")

    response = await client.get("/agent/notes/index.md", headers={"Authorization": "Basic x"})

    assert response.status_code == 401


async def test_a_bearer_the_store_does_not_hold_is_refused(
    client: AsyncClient, agent_vault: Path, token: str
) -> None:
    # Well-formed and the right shape, and still nothing: the store decides,
    # not the spelling.
    (agent_vault / "index.md").write_text("# index")

    response = await client.get(
        "/agent/notes/index.md", headers={"Authorization": f"Bearer {token}x"}
    )

    assert response.status_code == 401


async def test_a_valid_bearer_is_let_through(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "index.md").write_text("# index")

    response = await client.get("/agent/notes/index.md", headers=bearer)

    assert response.status_code == 200


async def test_a_revoked_token_is_refused_on_the_very_next_request(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # Nothing is held between requests, so a revoke takes effect at once rather
    # than when something expires.
    (agent_vault / "index.md").write_text("# index")
    assert (await client.get("/agent/notes/index.md", headers=bearer)).status_code == 200

    await revoke(get_settings().tokens_path, "laptop")

    assert (await client.get("/agent/notes/index.md", headers=bearer)).status_code == 401


async def test_absent_store_refuses_everything(
    client: AsyncClient, agent_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # There is no configuration in which the gate opens. A store that was never
    # written reads as an empty list, and no digest matches nothing.
    monkeypatch.setenv("KASTEN_TOKENS_PATH", str(agent_vault.parent / "absent.json"))
    get_settings.cache_clear()
    (agent_vault / "index.md").write_text("# index")

    response = await client.get(
        "/agent/notes/index.md", headers={"Authorization": "Bearer kasten_anything"}
    )

    assert response.status_code == 401


def revoked_file() -> Path:
    """The revoked file beside the store the app reads, which the agent vault fixture sets."""
    return get_settings().tokens_path.with_name(tokens.REVOKED)


@pytest.mark.parametrize("junk", ["{", "{}", "[1]", "1"])
async def test_a_broken_revoked_file_refuses_an_unknown_bearer_with_401(
    client: AsyncClient, agent_vault: Path, junk: str
) -> None:
    # Not a 500: a broken revoked file answers only the refusals, so an unknown
    # bearer is refused the same way it is with no file at all.
    (agent_vault / "index.md").write_text("# index")
    revoked_file().write_text(junk, encoding="utf-8")

    response = await client.get(
        "/agent/notes/index.md", headers={"Authorization": "Bearer kasten_junk"}
    )

    assert response.status_code == 401


async def test_a_broken_revoked_file_refuses_a_revoked_bearer_with_401(
    client: AsyncClient, agent_vault: Path, token: str
) -> None:
    (agent_vault / "index.md").write_text("# index")
    await revoke(get_settings().tokens_path, "laptop")
    revoked_file().write_text("{", encoding="utf-8")

    response = await client.get(
        "/agent/notes/index.md", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401


async def test_a_broken_revoked_file_is_logged(
    client: AsyncClient, agent_vault: Path, caplog: pytest.LogCaptureFixture
) -> None:
    # The log says which file is broken, and never what is in it: the file holds
    # digests, and a bearer must not reach the log by any route.
    (agent_vault / "index.md").write_text("# index")
    revoked_file().write_text("{", encoding="utf-8")
    caplog.set_level(logging.WARNING, logger="kasten_backend.tokens")

    await client.get("/agent/notes/index.md", headers={"Authorization": "Bearer kasten_junk"})

    assert any("tokens-revoked.json" in record.getMessage() for record in caplog.records)
    assert "kasten_junk" not in caplog.text


async def test_a_pruned_revoked_token_stays_refused(
    client: AsyncClient, agent_vault: Path, token: str
) -> None:
    # Once the file has forgotten a revoked token, the token is unknown, and an
    # unknown token is refused, so pruning can never readmit it.
    (agent_vault / "index.md").write_text("# index")
    store = get_settings().tokens_path
    await revoke(store, "laptop")
    for _ in range(tokens.REVOKED_KEPT):
        await tokens.mint(store, "claude")
        await revoke(store, "claude")

    revoked = json.loads(revoked_file().read_text(encoding="utf-8"))
    assert len(revoked) == tokens.REVOKED_KEPT
    assert tokens.digest(token) not in revoked_file().read_text(encoding="utf-8")
    response = await client.get(
        "/agent/notes/index.md", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 401


async def test_revoke_on_a_broken_revoked_file_completes(
    client: AsyncClient, agent_vault: Path, token: str
) -> None:
    # The broken file is set aside, not fatal: the revoke answers 204 and the
    # record starts a fresh file. The broken copy is kept for whoever looks.
    revoked_file().write_text("{", encoding="utf-8")

    response = await client.delete("/api/tokens/laptop")

    assert response.status_code == 204
    store = get_settings().tokens_path
    assert json.loads(store.read_text(encoding="utf-8")) == []
    fresh = json.loads(revoked_file().read_text(encoding="utf-8"))
    assert [record["name"] for record in fresh] == ["laptop"]
    assert revoked_file().with_name(tokens.REVOKED + ".broken").read_text(encoding="utf-8") == "{"


async def test_a_broken_revoked_file_still_lets_an_active_bearer_through(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # The active file is checked first, so a broken revoked file is never reached
    # by a bearer that is still active.
    (agent_vault / "index.md").write_text("# index")
    revoked_file().write_text("{", encoding="utf-8")

    response = await client.get("/agent/notes/index.md", headers=bearer)

    assert response.status_code == 200
