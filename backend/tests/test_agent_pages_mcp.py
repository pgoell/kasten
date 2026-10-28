"""An HTML page written from its text over MCP, and the refusals that come with it.

`save_file` takes a `url` for a download or `content` for a page, never both
and never neither. The page's own rules are `page_store.store_page`'s; these check
what the tool hands back and what it refuses.
"""

from typing import TYPE_CHECKING

import httpx
import pytest

from backend.tests.test_mcp import ENDPOINT, RPC, call, payload
from kasten_backend import files
from kasten_backend.agent_mcp import REDUNDANT, instructions

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from httpx import AsyncClient

PAGE = "<!doctype html><h1>Reading list</h1>"


@pytest.fixture
def answer(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> Callable[[Callable], None]:
    """Say what the internet replies with. Takes `client` so the test's own is built first."""

    def use(handler: Callable) -> None:
        monkeypatch.setattr(files, "_PublicTransport", lambda: httpx.MockTransport(handler))

    return use


async def test_the_mcp_tool_writes_an_html_page(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "reading/list.html", "content": PAGE}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["structuredContent"] == {"path": "reading/list.html"}
    assert (agent_vault / "reading" / "list.html").read_bytes() == PAGE.encode()


async def test_the_mcp_tool_replaces_an_html_page(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "list.html", "content": PAGE}),
        headers={**bearer, **RPC},
    )

    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "list.html", "content": "<p>Newer</p>"}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["structuredContent"] == {"path": "list.html"}
    assert (agent_vault / "list.html").read_bytes() == b"<p>Newer</p>"


async def test_the_mcp_tool_refuses_page_content_at_a_note_path(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "list.md", "content": PAGE}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["isError"] is True
    assert "The vault will not take that path" in response.text
    assert not (agent_vault / "list.md").exists()


async def test_the_mcp_tool_refuses_page_content_at_an_asset_path(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "DDIA.pdf", "content": PAGE}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["isError"] is True
    assert not (agent_vault / "DDIA.pdf").exists()


async def test_the_mcp_tool_refuses_page_content_outside_the_vault(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "../escape.html", "content": PAGE}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["isError"] is True
    assert not (agent_vault.parent / "escape.html").exists()


async def test_the_mcp_tool_refuses_page_content_over_the_cap(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(files, "ASSET_LIMIT_BYTES", 10)

    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "big.html", "content": PAGE}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["isError"] is True
    assert "limit" in response.text
    assert not (agent_vault / "big.html").exists()


async def test_the_mcp_tool_refuses_url_and_content_together(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], answer: Callable
) -> None:
    opened: list[str] = []
    answer(lambda request: opened.append(str(request.url)) or httpx.Response(200, request=request))

    response = await client.post(
        ENDPOINT,
        json=call(
            "save_file",
            {"path": "list.html", "url": "https://example.com/list.html", "content": PAGE},
        ),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["isError"] is True
    assert "Pass url for a PDF, epub, image or sound, or content for an .html page" in response.text
    assert opened == []
    assert not (agent_vault / "list.html").exists()


async def test_the_mcp_tool_refuses_neither_url_nor_content(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "list.html"}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["isError"] is True
    assert "Pass url for a PDF, epub, image or sound, or content for an .html page" in response.text
    assert not (agent_vault / "list.html").exists()


async def test_the_mcp_tool_refuses_a_url_for_an_html_path(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], answer: Callable
) -> None:
    opened: list[str] = []
    answer(lambda request: opened.append(str(request.url)) or httpx.Response(200, request=request))

    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "list.html", "url": "https://example.com/list.html"}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["isError"] is True
    assert "The vault will not take that path" in response.text
    assert opened == []
    assert not (agent_vault / "list.html").exists()


def test_the_instructions_stay_under_the_claude_code_cut() -> None:
    assert len(instructions().encode()) < 2048


def test_the_served_instructions_stay_under_the_claude_code_cut() -> None:
    # What the field carries is the text and the line telling a client not to
    # call `read_guide`, and Claude Code cuts the whole of it at 2 KiB.
    assert len((instructions() + REDUNDANT).encode()) < 2048


def test_the_instructions_name_the_skills_tools() -> None:
    text = instructions()

    assert "list_skills and read_skill" in text
    assert '".claude/skills"' in text
    assert "nothing writes them" in text


def test_the_instructions_name_the_html_way_in() -> None:
    text = instructions()

    assert "save_file" in text
    assert "HTML" in text
