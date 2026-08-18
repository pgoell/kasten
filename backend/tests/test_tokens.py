"""The token store: what it hands out once, what it keeps, and who may read it."""

from typing import TYPE_CHECKING

import pytest

from kasten_backend import tokens

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

OWNER_ONLY = 0o600
"""The mode the store is written with, which is the whole of its file protection."""


async def test_mint_returns_a_secret_the_store_does_not_hold(tmp_path: Path) -> None:
    store = tmp_path / "tokens.json"

    minted = await tokens.mint(store, "laptop")

    assert minted.secret.startswith("kasten_")
    # The prefix is what makes a leaked token greppable and recognisable to a
    # secret scanner, and the absence below is the point of the digest.
    assert minted.secret not in store.read_text(encoding="utf-8")
    assert await tokens.verify(store, minted.secret) == "laptop"

    assert await tokens.revoke(store, "laptop") is True
    assert await tokens.verify(store, minted.secret) is None


async def test_store_file_is_owner_only(tmp_path: Path) -> None:
    store = tmp_path / "tokens.json"

    await tokens.mint(store, "laptop")

    assert store.stat().st_mode & 0o777 == OWNER_ONLY


async def test_minting_a_taken_name_raises(tmp_path: Path) -> None:
    store = tmp_path / "tokens.json"
    await tokens.mint(store, "laptop")

    with pytest.raises(ValueError, match="laptop"):
        await tokens.mint(store, "laptop")


async def test_listing_never_returns_a_digest(
    client: AsyncClient, agent_vault: Path, token: str
) -> None:
    response = await client.get("/api/tokens")

    assert response.status_code == 200
    assert [row["name"] for row in response.json()] == ["laptop"]
    assert all("digest" not in row for row in response.json())
    assert tokens.digest(token) not in response.text


async def test_minting_returns_the_secret_once(client: AsyncClient, agent_vault: Path) -> None:
    minted = await client.post("/api/tokens", json={"name": "cron"})

    assert minted.status_code == 201
    assert minted.json()["secret"].startswith("kasten_")
    listed = await client.get("/api/tokens")
    assert minted.json()["secret"] not in listed.text


async def test_minting_a_taken_name_is_a_conflict(
    client: AsyncClient, agent_vault: Path, token: str
) -> None:
    response = await client.post("/api/tokens", json={"name": "laptop"})

    assert response.status_code == 409


async def test_revoking_an_unknown_name_is_a_404(client: AsyncClient, agent_vault: Path) -> None:
    response = await client.delete("/api/tokens/nobody")

    assert response.status_code == 404


async def test_revoking_drops_the_token(client: AsyncClient, agent_vault: Path, token: str) -> None:
    response = await client.delete("/api/tokens/laptop")

    assert response.status_code == 204
    assert (await client.get("/api/tokens")).json() == []
