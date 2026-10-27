"""The gate in front of `/agent/`, which is the whole trust boundary.

One Caddy block carries this prefix to the open internet with no `oauth2_auth`
in front of it, so every case below is the difference between a stranger and the
vault.
"""

import json
import logging
import os
from typing import TYPE_CHECKING

import pytest

from kasten_backend import tokens
from kasten_backend.config import get_settings
from kasten_backend.tokens import revoke

if TYPE_CHECKING:
    from collections.abc import Iterator
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


ROOT = os.geteuid() == 0
"""Root reads a file whatever its mode, so `chmod 000` takes nothing away from it."""


def unreadable(path: Path) -> None:
    """Make `path` a file this process cannot open, and prove it does fail."""
    path.write_text("[]", encoding="utf-8")
    path.chmod(0)
    with pytest.raises(PermissionError):
        path.read_bytes()


@pytest.fixture
def give_back(agent_vault: Path) -> Iterator[None]:
    """Give both token files their mode back, so the cleanup of `tmp_path` can remove them."""
    yield
    store = get_settings().tokens_path
    for path in (store, store.with_name(tokens.REVOKED)):
        if path.is_file():
            path.chmod(0o600)


@pytest.mark.skipif(ROOT, reason="root reads a file whatever its mode")
async def test_an_unreadable_revoked_file_refuses_an_unknown_bearer_with_401(
    client: AsyncClient, agent_vault: Path, give_back: None
) -> None:
    # A permission error answers the same as no file at all, not a 500.
    (agent_vault / "index.md").write_text("# index")
    unreadable(revoked_file())

    response = await client.get(
        "/agent/notes/index.md", headers={"Authorization": "Bearer kasten_junk"}
    )

    assert response.status_code == 401


@pytest.mark.skipif(ROOT, reason="root reads a file whatever its mode")
async def test_an_unreadable_revoked_file_refuses_a_revoked_bearer_with_401(
    client: AsyncClient, agent_vault: Path, token: str, give_back: None
) -> None:
    (agent_vault / "index.md").write_text("# index")
    await revoke(get_settings().tokens_path, "laptop")
    revoked_file().chmod(0)

    response = await client.get(
        "/agent/notes/index.md", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401


@pytest.mark.skipif(ROOT, reason="root reads a file whatever its mode")
async def test_an_unreadable_revoked_file_is_logged_by_path_alone(
    client: AsyncClient,
    agent_vault: Path,
    token: str,
    give_back: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    (agent_vault / "index.md").write_text("# index")
    await revoke(get_settings().tokens_path, "laptop")
    revoked_file().chmod(0)
    caplog.set_level(logging.WARNING, logger="kasten_backend.tokens")

    await client.get("/agent/notes/index.md", headers={"Authorization": f"Bearer {token}"})

    assert any("tokens-revoked.json" in record.getMessage() for record in caplog.records)
    assert token not in caplog.text
    assert tokens.digest(token) not in caplog.text


@pytest.mark.skipif(ROOT, reason="root reads a file whatever its mode")
@pytest.mark.parametrize("kind", ["permission", "directory"])
async def test_revoke_on_an_unreadable_revoked_file_completes(
    client: AsyncClient, agent_vault: Path, token: str, give_back: None, kind: str
) -> None:
    # A directory in the file's place is unreadable too. Main read it as no
    # file, wrote `tokens.json` and then failed to write over the directory.
    if kind == "permission":
        unreadable(revoked_file())
    else:
        revoked_file().mkdir()

    response = await client.delete("/api/tokens/laptop")

    assert response.status_code == 204
    store = get_settings().tokens_path
    assert json.loads(store.read_text(encoding="utf-8")) == []
    fresh = json.loads(revoked_file().read_text(encoding="utf-8"))
    assert [record["name"] for record in fresh] == ["laptop"]
    assert revoked_file().with_name(tokens.REVOKED + ".broken").exists()


async def test_a_failed_rename_of_a_broken_revoked_file_still_cuts_the_token(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # A revoke that cannot be recorded still revokes. The broken file stays as
    # it is, since a directory in its place cannot be written over either.
    (agent_vault / "index.md").write_text("# index")
    store = get_settings().tokens_path
    revoked_file().write_text("{", encoding="utf-8")
    aside = revoked_file().with_name(tokens.REVOKED + ".broken")
    aside.mkdir()
    (aside / "keep").write_text("x", encoding="utf-8")

    assert await revoke(store, "laptop") is True

    assert json.loads(store.read_text(encoding="utf-8")) == []
    assert revoked_file().read_text(encoding="utf-8") == "{"
    response = await client.get("/agent/notes/index.md", headers=bearer)
    assert response.status_code == 401


@pytest.mark.skipif(ROOT, reason="root reads a file whatever its mode")
async def test_an_unreadable_revoked_file_still_lets_an_active_bearer_through(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], give_back: None
) -> None:
    # Only `tokens.json` admits a bearer, and a revoked token is never in it, so
    # the revoked file cannot decide who gets in and is never read for this one.
    (agent_vault / "index.md").write_text("# index")
    unreadable(revoked_file())

    response = await client.get("/agent/notes/index.md", headers=bearer)

    assert response.status_code == 200


@pytest.mark.skipif(ROOT, reason="root reads a file whatever its mode")
async def test_an_unreadable_store_refuses_every_bearer_with_401(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    give_back: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # A valid bearer too: a file that cannot be read admits nobody.
    (agent_vault / "index.md").write_text("# index")
    get_settings().tokens_path.chmod(0)
    caplog.set_level(logging.WARNING, logger="kasten_backend.tokens")

    valid = await client.get("/agent/notes/index.md", headers=bearer)
    junk = await client.get(
        "/agent/notes/index.md", headers={"Authorization": "Bearer kasten_junk"}
    )

    assert valid.status_code == 401
    assert junk.status_code == 401
    assert any("tokens.json" in record.getMessage() for record in caplog.records)
    assert bearer["Authorization"].removeprefix("Bearer ") not in caplog.text


@pytest.mark.parametrize("junk", [b"{", b"[1]", b"1", b"null", b"\xff"])
async def test_a_broken_store_refuses_a_bearer_with_401(
    client: AsyncClient, agent_vault: Path, junk: bytes
) -> None:
    (agent_vault / "index.md").write_text("# index")
    get_settings().tokens_path.write_bytes(junk)

    response = await client.get(
        "/agent/notes/index.md", headers={"Authorization": "Bearer kasten_junk"}
    )

    assert response.status_code == 401
