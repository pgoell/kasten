"""Migration 0012 goes up, comes down without taking anything else, and goes up again.

On the scratch database, so the downgrade never touches `kasten_dev`. The
database is left at head whether or not the assertions hold.
"""

from sqlalchemy import create_engine, text

from backend.tests.conftest import alembic

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
        assert tables(scratch_database) == at_head - {"public.token_action"}
    finally:
        alembic(scratch_database, "upgrade", "head")

    assert tables(scratch_database) == at_head
