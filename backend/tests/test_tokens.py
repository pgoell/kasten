"""The token store: what it hands out once, what it keeps, and who may read it."""

import json
import os
from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError

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


async def test_revoked_file_stays_bounded_across_reconnects(tmp_path: Path) -> None:
    # Every OAuth reconnect revokes and mints the same name, so the file would
    # otherwise grow by one record per reconnect for good.
    store = tmp_path / "tokens.json"

    for _ in range(tokens.REVOKED_KEPT + 10):
        await tokens.mint(store, "claude")
        await tokens.revoke(store, "claude")

    revoked = json.loads((tmp_path / tokens.REVOKED).read_text(encoding="utf-8"))
    assert len(revoked) == tokens.REVOKED_KEPT


async def test_mint_and_revoke_on_a_broken_store_leave_it_alone(tmp_path: Path) -> None:
    # The store is strict: a broken one raises before anything is written, so a
    # revoke cannot half-move a token out of a file it could not read.
    store = tmp_path / "tokens.json"
    store.write_text("{", encoding="utf-8")

    with pytest.raises(ValidationError):
        await tokens.mint(store, "laptop")
    with pytest.raises(ValidationError):
        await tokens.revoke(store, "laptop")

    assert store.read_text(encoding="utf-8") == "{"
    assert not (tmp_path / tokens.REVOKED).exists()


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads a file whatever its mode")
async def test_mint_revoke_and_listing_on_an_unreadable_store_leave_it_alone(
    tmp_path: Path,
) -> None:
    # Only `identify` is lenient. Here a read that failed and returned nothing
    # would write a store of one token, or of none, over every token there is.
    store = tmp_path / "tokens.json"
    await tokens.mint(store, "laptop")
    before = store.read_bytes()
    store.chmod(0)
    try:
        with pytest.raises(PermissionError):
            await tokens.mint(store, "phone")
        with pytest.raises(PermissionError):
            await tokens.revoke(store, "laptop")
        with pytest.raises(PermissionError):
            await tokens.listing(store)
    finally:
        store.chmod(0o600)

    assert store.read_bytes() == before
    assert not (tmp_path / tokens.REVOKED).exists()


async def test_a_broken_store_error_quotes_no_digest(tmp_path: Path) -> None:
    # The error escapes `listing` into a traceback in the log, so its text
    # must not carry the tail of the file, which holds a digest.
    store = tmp_path / "tokens.json"
    await tokens.mint(store, "laptop")
    whole = store.read_bytes()
    store.write_bytes(whole[:-3])
    held = json.loads(whole)[0]["digest"]

    with pytest.raises(ValidationError) as raised:
        await tokens.listing(store)

    assert held[-12:] not in str(raised.value)
