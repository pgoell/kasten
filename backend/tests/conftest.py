import shutil
import subprocess
from typing import TYPE_CHECKING

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app
from kasten_backend.tokens import mint

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator
    from pathlib import Path

JJ = shutil.which("jj")
"""Where jj is, or None on a box without it, which every jj test skips on."""


@pytest.fixture(autouse=True)
def startup_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """The vault the app writes its agent guide into on startup, one per test.

    Autouse because the startup write reads the settings rather than the
    override below, which only answers a request. Without this every test that
    runs the lifespan would write the guide into the repo's own vault.
    """
    root = tmp_path / "startup"
    monkeypatch.setenv("KASTEN_VAULT_PATH", str(root))
    get_settings.cache_clear()

    yield root

    get_settings.cache_clear()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with (
        LifespanManager(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http_client,
    ):
        yield http_client


@pytest.fixture
async def agent_vault(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[Path]:
    """An empty vault with a token store beside it, reached through the environment.

    Not `app.dependency_overrides[get_settings]`, which the `vault` fixture below
    uses: the bearer check and the MCP tools read the settings outside a request,
    and an override only answers one. `KASTEN_TOKENS_PATH` is set rather than
    left at its default, which is the cwd-relative `tokens.json`, so a test that
    mints does not write into the repo root.

    `client` is a parameter rather than a sibling so the lifespan runs first and
    writes its guides into the startup vault. That is what leaves this one empty.
    """
    root = tmp_path / "agent"
    root.mkdir()
    monkeypatch.setenv("KASTEN_VAULT_PATH", str(root))
    monkeypatch.setenv("KASTEN_TOKENS_PATH", str(tmp_path / "tokens.json"))
    get_settings.cache_clear()

    yield root

    get_settings.cache_clear()


@pytest.fixture
async def token(agent_vault: Path) -> str:
    """One token called `laptop`, and the only copy of its secret.

    Takes the vault so the store is the one beside it, and reads the path off the
    settings rather than rebuilding it.
    """
    return (await mint(get_settings().tokens_path, "laptop")).secret


@pytest.fixture
def bearer(token: str) -> dict[str, str]:
    """The header a token holder sends, which every `/agent/` request carries."""
    return {"Authorization": f"Bearer {token}"}


def _serve_vault(root: Path) -> Iterator[Path]:
    app.dependency_overrides[get_settings] = lambda: Settings(vault_path=root)

    yield root

    app.dependency_overrides.clear()


@pytest.fixture
def vault(tmp_path: Path) -> Iterator[Path]:
    """Point the app at an empty throwaway vault and hand the test its path."""
    root = tmp_path / "vault"
    root.mkdir()
    yield from _serve_vault(root)


@pytest.fixture
def missing_vault(tmp_path: Path) -> Iterator[Path]:
    """Point the app at a vault directory that was never created."""
    yield from _serve_vault(tmp_path / "absent")


def jj(vault: Path, *args: str) -> str:
    """Run a jj command against the test vault and hand back its output."""
    assert JJ is not None
    finished = subprocess.run(  # noqa: S603
        [JJ, "--repository", str(vault), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return finished.stdout


def descriptions(vault: Path) -> list[str]:
    """Every change in the repo, newest first, described."""
    log = jj(vault, "log", "--no-graph", "-T", 'description ++ "\\n"')
    return [line for line in log.splitlines() if line]


def changed_paths(vault: Path, revision: str) -> list[str]:
    """Every path one change touches, spelled from the vault root."""
    # `--ignore-working-copy` because every other jj command snapshots the
    # working copy on the way past, which would record a note the route left
    # unrecorded and answer the question the test is asking.
    listing = jj(
        vault,
        "--ignore-working-copy",
        "log",
        "-r",
        revision,
        "--no-graph",
        "-T",
        'diff.files().map(|file| file.path()).join("\\n")',
    )
    return [line for line in listing.splitlines() if line]


def moved_paths(vault: Path, revision: str) -> list[str]:
    """Every path one change touches, spelled `source -> target`.

    A rename is one entry with two different paths, because jj matches the
    content across the move rather than recording a delete and an add. Anything
    else names the same path twice.
    """
    template = (
        'diff.files().map(|file| file.source().path() ++ " -> " ++ file.target().path())'
        '.join("\\n")'
    )
    listing = jj(
        vault, "--ignore-working-copy", "log", "-r", revision, "--no-graph", "-T", template
    )
    return [line for line in listing.splitlines() if line]


@pytest.fixture
def versioned_vault(vault: Path) -> Iterator[Path]:
    """A vault that is a colocated jj repo, the way the runbook sets one up."""
    assert JJ is not None
    # Not through `jj()`: `--repository` names a repo that does not exist yet.
    subprocess.run(  # noqa: S603
        [JJ, "git", "init", "--colocate", str(vault)],
        capture_output=True,
        text=True,
        check=True,
    )
    yield vault
