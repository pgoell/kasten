"""The gate in front of `/agent/`, which is the whole trust boundary.

One Caddy block carries this prefix to the open internet with no `oauth2_auth`
in front of it, so every case below is the difference between a stranger and the
vault.
"""

from typing import TYPE_CHECKING

from kasten_backend.config import get_settings
from kasten_backend.tokens import revoke

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
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
