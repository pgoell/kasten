"""The token store: what it hands out once, what it keeps, and who may read it."""

from typing import TYPE_CHECKING

import pytest

from kasten_backend import tokens

if TYPE_CHECKING:
    from pathlib import Path

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
