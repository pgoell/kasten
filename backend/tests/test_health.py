"""The health route, the `client` fixture that waits out the lifespan, and the slow-request log."""

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend import main
from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from httpx import AsyncClient
    from starlette.types import ASGIApp, Message, Receive, Scope, Send


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


class Clock:
    """A clock the test moves by hand, so slow and fast never depend on the box's load."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    fake = Clock()
    monkeypatch.setattr(main, "clock", fake)
    return fake


def answering(
    clock: Clock, ms: float, *, status: int = 200, fails: bool = False, kind: bytes = b"text/plain"
) -> ASGIApp:
    """An app that sends its headers at once and its last chunk `ms` later."""

    async def app(_scope: Scope, _receive: Receive, send: Send) -> None:
        headers = [(b"content-type", kind)]
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": b"a", "more_body": True})
        clock.now += ms / 1000
        await send({"type": "http.response.body", "body": b"b", "more_body": False})
        if fails:
            raise RuntimeError

    return app


async def request(app: ASGIApp, method: str, path: str, query: bytes = b"") -> None:
    scope = {"type": "http", "method": method, "path": path, "query_string": query}

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(_message: Message) -> None:
        pass

    await main.SlowRequests(app)(scope, receive, send)


def slow_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == "kasten_backend.main" and record.getMessage().startswith("slow request")
    ]


async def test_a_slow_request_leaves_one_line_timed_to_its_last_chunk(
    clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    await request(answering(clock, 300, status=201), "POST", "/api/notes/a.md")

    assert slow_lines(caplog) == ["slow request: POST '/api/notes/a.md' 201 300 ms"]
    assert caplog.records[-1].levelname == "WARNING"


async def test_a_fast_request_leaves_no_line(
    clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    await request(answering(clock, 249), "GET", "/api/notes/a.md")

    assert slow_lines(caplog) == []


async def test_the_threshold_is_250_ms_unless_kasten_slow_request_ms_says_otherwise(
    clock: Clock, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    await request(answering(clock, 251), "GET", "/default")
    monkeypatch.setenv("KASTEN_SLOW_REQUEST_MS", "1000")
    get_settings.cache_clear()
    await request(answering(clock, 900), "GET", "/under")
    await request(answering(clock, 1001), "GET", "/over")

    assert slow_lines(caplog) == [
        "slow request: GET '/default' 200 251 ms",
        "slow request: GET '/over' 200 1001 ms",
    ]


async def test_the_streams_that_stay_open_leave_no_line(
    clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    await request(answering(clock, 60_000), "GET", "/api/events")
    await request(answering(clock, 60_000), "GET", "/agent/mcp")
    await request(answering(clock, 60_000), "GET", "/agent/mcp/")
    await request(answering(clock, 60_000), "GET", "/share/events")
    await request(answering(clock, 60_000), "GET", "/api/events/")

    assert slow_lines(caplog) == []


async def test_any_event_stream_leaves_no_line_whatever_its_path(
    clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    sse = b"text/event-stream; charset=utf-8"
    await request(answering(clock, 60_000, kind=sse), "GET", "/api/some-new-stream")
    with pytest.raises(RuntimeError):
        await request(answering(clock, 60_000, kind=sse, fails=True), "GET", "/api/dying-stream")

    assert slow_lines(caplog) == []


async def test_the_skips_match_exactly_so_a_slow_tool_call_still_logs(
    clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    await request(answering(clock, 300), "GET", "/api/eventsx")
    await request(answering(clock, 300), "POST", "/agent/mcp")

    assert slow_lines(caplog) == [
        "slow request: GET '/api/eventsx' 200 300 ms",
        "slow request: POST '/agent/mcp' 200 300 ms",
    ]


async def test_a_query_string_never_shows(clock: Clock, caplog: pytest.LogCaptureFixture) -> None:
    await request(answering(clock, 300), "GET", "/api/search", b"q=x&token=kasten_secret")

    assert slow_lines(caplog) == ["slow request: GET '/api/search' 200 300 ms"]
    assert "kasten_secret" not in caplog.text


async def test_a_slow_request_that_raises_still_logs_500(
    clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    async def failing(_scope: Scope, _receive: Receive, _send: Send) -> None:
        clock.now += 0.3
        raise RuntimeError

    with pytest.raises(RuntimeError):
        await request(failing, "GET", "/api/broken")
    with pytest.raises(RuntimeError):
        await request(answering(clock, 300, fails=True), "GET", "/api/late")

    assert slow_lines(caplog) == [
        "slow request: GET '/api/broken' 500 300 ms",
        "slow request: GET '/api/late' 200 300 ms",
    ]


async def test_a_newline_in_the_path_stays_on_one_line(
    clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    await request(answering(clock, 300), "GET", "/api/x\nslow request: GET '/forged' 200 1 ms")

    [line] = slow_lines(caplog)
    assert "\n" not in line


async def test_the_app_logs_a_slow_request_without_its_query_string(
    client: AsyncClient, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A threshold below zero makes every request slow, so the real app needs no slow route.
    monkeypatch.setenv("KASTEN_SLOW_REQUEST_MS", "-1")
    get_settings.cache_clear()

    response = await client.get("/api/health", params={"token": "kasten_secret"})

    assert response.status_code == 200
    [line] = slow_lines(caplog)
    assert line.startswith("slow request: GET '/api/health' 200 ")
    assert "kasten_secret" not in caplog.text


def test_the_configuration_page_names_the_setting() -> None:
    page = Path(__file__).resolve().parents[2] / "docs/reference/configuration.md"

    assert "## KASTEN_SLOW_REQUEST_MS" in page.read_text()
