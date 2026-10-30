"""Migration 0012 goes up, comes down without taking anything else, and goes up again.

On the scratch database, so the downgrade never touches `kasten_dev`. The
database is left at head whether or not the assertions hold. The scratch
database itself is dropped, and says why, when its migration fails (#1336).
"""

import subprocess

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from backend.tests import conftest
from backend.tests.conftest import alembic, migrated_database
from kasten_backend.config import Settings

TABLES = text(
    "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname IN ('public', 'finance')"
)


def tables(url: str) -> set[str]:
    """Every table kasten keeps, in the public and finance schemas, by schema and name."""
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return {row[0] for row in connection.execute(TABLES)}
    finally:
        engine.dispose()


def test_migration_0012_goes_up_down_and_up(scratch_database: str) -> None:
    at_head = tables(scratch_database)
    assert "public.token_action" in at_head

    try:
        alembic(scratch_database, "downgrade", "0011")
        # Going below 0012 takes 0013's pieces tables down with it.
        later = {"public.token_action", "public.pieces", "public.piece_notes"}
        assert tables(scratch_database) == at_head - later
    finally:
        alembic(scratch_database, "upgrade", "head")

    assert tables(scratch_database) == at_head


def test_a_failed_alembic_run_names_its_cause() -> None:
    # Nothing listens on port 1, so alembic fails on connect and says so on stderr.
    with pytest.raises(RuntimeError, match="Connection refused"):
        alembic("postgresql+psycopg://k:k@127.0.0.1:1/k", "upgrade", "head")


def test_a_failed_migration_drops_the_scratch_database(monkeypatch: pytest.MonkeyPatch) -> None:
    url = make_url(Settings().database_url)
    maintenance = create_engine(
        url.set(database="postgres", drivername="postgresql+psycopg"),
        isolation_level="AUTOCOMMIT",
    )
    try:
        with maintenance.connect() as connection:
            connection.execute(text("SELECT 1"))
    except OperationalError:
        maintenance.dispose()
        pytest.skip("No database answers at KASTEN_DATABASE_URL")

    def fail(*args: str) -> None:
        raise RuntimeError("alembic upgrade head failed")

    monkeypatch.setattr(conftest, "alembic", fail)
    name = "kasten_scratch_failed_migration"

    with pytest.raises(RuntimeError), migrated_database(url, name):
        pass

    try:
        with maintenance.connect() as connection:
            left = connection.scalar(
                text("SELECT count(*) FROM pg_database WHERE datname = :name"), {"name": name}
            )
    finally:
        maintenance.dispose()
    assert left == 0


def test_a_failed_alembic_run_keeps_the_process_error() -> None:
    with pytest.raises(RuntimeError) as raised:
        alembic("postgresql+psycopg://k:k@127.0.0.1:1/k", "upgrade", "head")
    assert isinstance(raised.value.__cause__, subprocess.CalledProcessError)
