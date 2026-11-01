import os
import shutil
import subprocess
import sys
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

import httpcore
import httpx
import pytest
from asgi_lifespan import LifespanManager
from httpcore._backends.anyio import AnyIOBackend
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from backend.tests.anki_link_web import PUBLIC
from kasten_backend import db, files
from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.main import app
from kasten_backend.tokens import mint

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable, Iterator

JJ = shutil.which("jj")
"""Where jj is, or None on a box without it, which every jj test skips on."""

BACKEND = Path(__file__).resolve().parents[1]
"""The folder alembic.ini lives in, where `alembic` must run from."""


@pytest.fixture(autouse=True)
def no_git_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Drop the GIT_* variables a git hook sets, such as GIT_DIR.

    Under `git push` the pre-push hook runs the suite with them set, and a test
    that runs git in its own tmp repo would act on the real repo instead: in a
    worktree, `git init` set core.bare in its shared config.
    """
    for key in os.environ:
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)


@pytest.fixture(autouse=True)
def startup_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """The vault the app writes its agent guide into on startup, one per test.

    Autouse because the startup write reads the settings rather than the
    override below, which only answers a request. Without this every test that
    runs the lifespan would write the guide into the repo's own vault.
    """
    root = tmp_path / "startup"
    monkeypatch.setenv("KASTEN_VAULT_PATH", str(root))
    # Every `Settings`, the `vault` fixture's included, reads this, so no test
    # joins its pieces in the box's shared temp folder or wipes another's.
    monkeypatch.setenv("KASTEN_UPLOAD_PATH", str(tmp_path / "uploads"))
    monkeypatch.setenv("KASTEN_RECEIPTS_PATH", str(tmp_path / "receipts"))
    # The text cache of pdf, epub and html files, never the box's shared temp folder.
    monkeypatch.setenv("KASTEN_TEXT_CACHE_PATH", str(tmp_path / "text-cache"))
    get_settings.cache_clear()

    yield root

    get_settings.cache_clear()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    # The default 5s bound measures the box's load and the suite's gc, not the app,
    # so the test waits for the startup it needs.
    async with (
        LifespanManager(app, startup_timeout=None, shutdown_timeout=None),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http_client,
    ):
        yield http_client


@pytest.fixture
async def finance_session() -> AsyncIterator[AsyncSession]:
    """The session the finance routes get, on a database transaction rolled back after the test.

    The database is `KASTEN_DATABASE_URL`, which CI migrates before the tests
    run. A box with no database, or one never migrated, skips these rather than
    fails: the dev database is shared with checkouts that have no finance
    tables. The routes commit to a savepoint inside the outer transaction, so
    nothing a test writes outlives it.
    """
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        connection = await engine.connect()
    except OperationalError:
        await engine.dispose()
        pytest.skip("No database answers at KASTEN_DATABASE_URL")
    outer = await connection.begin()
    if await connection.scalar(text("SELECT to_regclass('finance.transaction')")) is None:
        await connection.close()
        await engine.dispose()
        pytest.skip("No finance tables in the database: run `mise run db:migrate`")
    session = AsyncSession(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    app.dependency_overrides[get_session] = lambda: session

    async def same() -> AsyncIterator[AsyncSession]:
        yield session

    # The MCP tools get no dependency, so the override above does not reach them.
    db.sessions = same

    yield session

    db.sessions = get_session
    app.dependency_overrides.pop(get_session)
    await session.close()
    await outer.rollback()
    await connection.close()
    await engine.dispose()


@pytest.fixture
def finance_client(client: AsyncClient, finance_session: AsyncSession) -> AsyncClient:
    """The client, with the finance routes on `finance_session`."""
    return client


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
def versioned_agent_vault(agent_vault: Path) -> Path:
    """The agent's vault, made a colocated jj repo, for the tests that read `jj log`."""
    assert JJ is not None
    # Not through `jj()`: `--repository` names a repo that does not exist yet.
    subprocess.run(  # noqa: S603
        [JJ, "git", "init", "--colocate", str(agent_vault)],
        capture_output=True,
        text=True,
        check=True,
    )
    return agent_vault


@pytest.fixture
def bearer(token: str) -> dict[str, str]:
    """The header a token holder sends, which every `/agent/` request carries."""
    return {"Authorization": f"Bearer {token}"}


def alembic(url: str, *args: str) -> None:
    """Run alembic against `url`, the way the app reads its database: from the environment."""
    try:
        subprocess.run(  # noqa: S603
            [sys.executable, "-m", "alembic", *args],
            cwd=BACKEND,
            env={**os.environ, "KASTEN_DATABASE_URL": url},
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        # The output is captured to keep a passing run quiet, and the error's
        # message leaves it out, so a failure would not say what went wrong.
        output = f"{error.stdout}{error.stderr}"
        raise RuntimeError(f"alembic {' '.join(args)} failed:\n{output}") from error


@contextmanager
def migrated_database(url: URL, name: str) -> Iterator[str]:
    """Database `name` beside `url`'s, migrated to head, dropped on the way out.

    Dropped too when the migration fails, or every failing run would leave one
    behind (#1336).
    """
    maintenance = create_engine(
        url.set(database="postgres", drivername="postgresql+psycopg"),
        isolation_level="AUTOCOMMIT",
    )
    try:
        with maintenance.connect() as connection:
            connection.execute(text(f"DROP DATABASE IF EXISTS {name}"))
            connection.execute(text(f"CREATE DATABASE {name}"))
    except OperationalError:
        maintenance.dispose()
        pytest.skip("No database answers at KASTEN_DATABASE_URL")

    try:
        scratch = url.set(database=name).render_as_string(hide_password=False)
        alembic(scratch, "upgrade", "head")
        yield scratch
    finally:
        with maintenance.connect() as connection:
            connection.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
        maintenance.dispose()


def pytest_configure(config: pytest.Config) -> None:
    """Give each xdist worker a database of its own: tests in one see rows and locks of another.

    `db` built its engine when this file imported it, hence the second engine here.
    """
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if worker is None:
        return
    database = migrated_database(
        make_url(Settings().database_url), f"kasten_{worker}_{os.getpid()}"
    )
    try:
        url = database.__enter__()
    except pytest.skip.Exception:
        return

    def drop() -> None:
        database.__exit__(None, None, None)

    config.add_cleanup(drop)
    os.environ["KASTEN_DATABASE_URL"] = url
    get_settings.cache_clear()
    db.engine = db.make_engine(url)
    # In place, as the indexer imported this factory by name.
    db.session_factory.configure(bind=db.engine)


@pytest.fixture(scope="session")
def scratch_database() -> Iterator[str]:
    """A database of this run's own, migrated to head, for the tests that write rows.

    `kasten_dev` is shared with other checkouts, and a 0012 applied there would
    break their upgrade, so the row tests never touch it. The name carries the
    process id, so two runs at once do not share one.
    """
    url = make_url(Settings().database_url)
    with migrated_database(url, f"kasten_scratch_{os.getpid()}") as scratch:
        yield scratch


@pytest.fixture
async def activity(
    scratch_database: str, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[AsyncEngine]:
    """The scratch database for the app's own sessions, emptied of token actions first.

    Both the activity recorder and the token listing read `db.session_factory`,
    and the finance routes and tools get their session from `get_session` and
    `db.sessions`, so all three are pointed at the scratch database.
    """
    engine = create_async_engine(scratch_database, poolclass=NullPool)
    async with engine.begin() as connection:
        if await connection.scalar(text("SELECT to_regclass('token_action')")) is not None:
            await connection.execute(text("DELETE FROM token_action"))

    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(db, "session_factory", factory)

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    previous = db.sessions
    db.sessions = sessions
    app.dependency_overrides[get_session] = sessions

    yield engine

    db.sessions = previous
    app.dependency_overrides.pop(get_session)
    await engine.dispose()


def _serve_vault(root: Path) -> Iterator[Path]:
    # Beside the vault, not in it: the cache must not put files in the vault, and
    # the override ignores the environment, so the cache is named here too.
    cache = root.parent / "text-cache"
    app.dependency_overrides[get_settings] = lambda: Settings(
        vault_path=root, text_cache_path=cache
    )

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


@pytest.fixture
def sockets(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every address the real transport went to open a socket to, none of them opened.

    For the tests of the address check, which has to run in the real transport
    because that is where it lives. A connect that got this far was allowed, so
    it fails here rather than reaching the network.
    """
    opened: list[str] = []

    async def connect(_backend: AnyIOBackend, host: str, *_args: object, **_kwargs: object) -> None:
        opened.append(host)
        raise httpcore.ConnectError("Tests open no sockets")

    monkeypatch.setattr(AnyIOBackend, "connect_tcp", connect)

    return opened


# Not autouse, so no test outside the anki link modules gets its DNS stubbed: those
# modules apply it to every test they hold, through `pytestmark`.
@pytest.fixture
def resolve(monkeypatch: pytest.MonkeyPatch) -> Callable[[dict[str, list[str]]], None]:
    """Hand back a way to say what a name resolves to, and keep DNS off the network."""
    table: dict[str, list[str]] = {}

    async def lookup(host: str) -> list[str]:
        return table.get(host, [PUBLIC])

    monkeypatch.setattr(files, "_addresses", lookup)

    return table.update


@pytest.fixture
def answer(monkeypatch: pytest.MonkeyPatch) -> Callable[[Callable], None]:
    """Hand back a way to say what the internet replies with, keeping the real client."""

    def use(handler: Callable) -> None:
        monkeypatch.setattr(files, "_PublicTransport", lambda: httpx.MockTransport(handler))

    return use


class _Tomorrow(date):
    """A `date` whose today is the day after the real one, for #1315."""

    @classmethod
    def today(cls) -> date:
        return date.today() + timedelta(days=1)


@pytest.fixture(autouse=True)
def cross_midnight(monkeypatch: pytest.MonkeyPatch) -> None:
    """With `KASTEN_CROSS_MIDNIGHT` set, the code's clock runs a day ahead of the test's.

    That is what a run sees when midnight falls between the moment a test reads
    today and the moment the code stamps it, so a test that compares the two
    without pinning the clock fails under it. Only `frontend/scripts/cross-midnight.sh`
    sets it. A test that pins its own clock patches after this and wins.
    """
    if not os.environ.get("KASTEN_CROSS_MIDNIGHT"):
        return
    monkeypatch.setattr("kasten_backend.share.date", _Tomorrow)
    monkeypatch.setattr("kasten_backend.routes.web.date", _Tomorrow)
    # GitHub counts days in UTC, so its clock turns at the next UTC midnight.
    tomorrow = datetime.now(UTC).date() + timedelta(days=1)
    turned = datetime.combine(tomorrow, datetime.min.time(), UTC)
    monkeypatch.setattr("kasten_backend.github._now", lambda: turned + timedelta(seconds=1))


PINNED_DAY = date(2026, 8, 10)
"""The day `pinned_day` holds the code's clock on."""


class _Pinned(date):
    """A `date` whose today is `PINNED_DAY`."""

    @classmethod
    def today(cls) -> date:
        return PINNED_DAY


@pytest.fixture
def pinned_day(monkeypatch: pytest.MonkeyPatch) -> date:
    """Hold the day the share code stamps on `PINNED_DAY`, and return it.

    The code reads today when it writes, so a test that read it before fails
    when midnight falls between the two (#1315). Asked for by name, it runs
    after `cross_midnight` and wins over it.
    """
    monkeypatch.setattr("kasten_backend.share.date", _Pinned)
    monkeypatch.setattr("kasten_backend.routes.web.date", _Pinned)
    return PINNED_DAY
