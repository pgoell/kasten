"""The health route, and the `client` fixture that waits on the app's lifespan, not a 5s clock."""

import asyncio
from typing import TYPE_CHECKING

import pytest

from kasten_backend import main

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_health_reports_ok(client: AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.fixture
async def late_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the loop believe six seconds passed while the lifespan starts.

    The clock is jumped rather than slept through, so the test takes no real time.
    """
    original = main.write_guide

    async def slow(root: Path) -> None:
        await original(root)
        loop = asyncio.get_running_loop()
        now = loop.time
        monkeypatch.setattr(loop, "time", lambda: now() + 6)

    monkeypatch.setattr(main, "write_guide", slow)


@pytest.fixture
async def late_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the loop believe six seconds passed while the lifespan shuts down."""
    original = main.anki_imports.stop

    async def slow() -> None:
        await original()
        loop = asyncio.get_running_loop()
        now = loop.time
        monkeypatch.setattr(loop, "time", lambda: now() + 6)
        # One turn of the loop, so it checks the shutdown timer before the lifespan
        # reports the shutdown complete.
        await asyncio.sleep(0)

    monkeypatch.setattr(main.anki_imports, "stop", slow)


async def test_the_client_waits_out_a_startup_slower_than_five_seconds(
    late_startup: None, client: AsyncClient
) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200


async def test_the_client_waits_out_a_shutdown_slower_than_five_seconds(
    late_shutdown: None, client: AsyncClient
) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
