"""Filing a book or an image from outside the box: raw bytes over REST, a URL over MCP.

The upload's own rules, the cap, the magic, the hard link and the cleanup, are
`test_assets.py`'s, which drives the same `files.store` from the browser's route.
These cover what is new here: the bearer in front, the download and its address
check, and the MCP tool's refusals arriving as tool errors.
"""

from functools import partial
from typing import TYPE_CHECKING

import httpx
import pytest

from backend.tests.test_mcp import ENDPOINT, RPC, call, payload
from kasten_backend import files

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from httpx import AsyncClient

PDF = b"%PDF-1.7\n" + b"x" * 64
PUBLIC = "93.184.215.14"


def empty(root: Path) -> bool:
    """Whether a refusal left the vault as it found it, no temp beside the target included."""
    return not any(root.iterdir())


@pytest.fixture(autouse=True)
def resolve(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[str]]:
    """Every name is public unless a test says otherwise, and DNS stays off the network."""
    table: dict[str, list[str]] = {}

    async def lookup(host: str) -> list[str]:
        return table.get(host, [PUBLIC])

    monkeypatch.setattr(files, "_addresses", lookup)

    return table


@pytest.fixture
def answer(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> Callable[[Callable], None]:
    """Say what the internet replies with. Takes `client` so the test's own is built first."""

    def use(handler: Callable) -> None:
        monkeypatch.setattr(
            files.httpx,
            "AsyncClient",
            partial(httpx.AsyncClient, transport=httpx.MockTransport(handler)),
        )

    return use


async def test_an_upload_lands(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post("/agent/files/20 Literature/DDIA.pdf", content=PDF, headers=bearer)

    assert response.status_code == 201
    assert response.json() == {"path": "20 Literature/DDIA.pdf"}
    assert (agent_vault / "20 Literature" / "DDIA.pdf").read_bytes() == PDF


async def test_an_upload_needs_a_token(client: AsyncClient, agent_vault: Path) -> None:
    response = await client.post("/agent/files/DDIA.pdf", content=PDF)

    assert response.status_code == 401
    assert not (agent_vault / "DDIA.pdf").exists()


async def test_an_upload_never_overwrites(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "DDIA.pdf").write_bytes(b"%PDF-mine")

    response = await client.post("/agent/files/DDIA.pdf", content=PDF, headers=bearer)

    assert response.status_code == 409
    assert (agent_vault / "DDIA.pdf").read_bytes() == b"%PDF-mine"


async def test_an_upload_refuses_a_note_path(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post("/agent/files/DDIA.md", content=PDF, headers=bearer)

    assert response.status_code == 400
    assert response.json()["detail"] == "The vault will not take that path"


async def test_an_upload_refuses_bytes_that_are_not_its_suffix(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post("/agent/files/DDIA.pdf", content=b"<html>", headers=bearer)

    assert response.status_code == 400
    assert response.json()["detail"] == "That file is not what its name says"
    assert empty(agent_vault)


async def test_a_fetch_lands(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], answer: Callable
) -> None:
    answer(lambda request: httpx.Response(200, content=PDF, request=request))

    response = await client.post(
        "/agent/files/papers/edge.pdf/fetch",
        json={"url": "https://example.com/edge.pdf"},
        headers=bearer,
    )

    assert response.status_code == 201
    assert response.json() == {"path": "papers/edge.pdf"}
    assert (agent_vault / "papers" / "edge.pdf").read_bytes() == PDF


async def test_a_fetch_refuses_a_private_address(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    answer: Callable,
    resolve: dict[str, list[str]],
) -> None:
    opened: list[str] = []
    answer(lambda request: opened.append(str(request.url)) or httpx.Response(200, content=PDF))
    resolve["db"] = ["172.18.0.2"]

    response = await client.post(
        "/agent/files/edge.pdf/fetch", json={"url": "http://db/edge.pdf"}, headers=bearer
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "That address is not on the internet"
    assert opened == []
    assert empty(agent_vault)


async def test_a_fetch_refuses_a_redirect_into_the_box(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    answer: Callable,
    resolve: dict[str, list[str]],
) -> None:
    resolve["localhost"] = ["127.0.0.1"]
    answer(
        lambda request: httpx.Response(
            302, headers={"location": "http://localhost/secret.pdf"}, request=request
        )
    )

    response = await client.post(
        "/agent/files/edge.pdf/fetch", json={"url": "https://example.com/a"}, headers=bearer
    )

    assert response.status_code == 400
    assert empty(agent_vault)


async def test_a_fetch_reports_a_failed_page(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], answer: Callable
) -> None:
    answer(lambda request: httpx.Response(404, request=request))

    response = await client.post(
        "/agent/files/edge.pdf/fetch", json={"url": "https://example.com/a"}, headers=bearer
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "That address answered 404"
    assert empty(agent_vault)


async def test_a_fetch_checks_the_path_before_opening_anything(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], answer: Callable
) -> None:
    opened: list[str] = []
    answer(lambda request: opened.append(str(request.url)) or httpx.Response(200, content=PDF))

    response = await client.post(
        "/agent/files/edge.md/fetch", json={"url": "https://example.com/a"}, headers=bearer
    )

    assert response.status_code == 400
    assert opened == []


async def test_the_mcp_tool_files_a_url(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], answer: Callable
) -> None:
    answer(lambda request: httpx.Response(200, content=PDF, request=request))

    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "DDIA.pdf", "url": "https://example.com/ddia.pdf"}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["structuredContent"] == {"path": "DDIA.pdf"}
    assert (agent_vault / "DDIA.pdf").read_bytes() == PDF


async def test_an_mcp_refusal_is_a_tool_error(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], answer: Callable
) -> None:
    answer(lambda request: httpx.Response(200, content=b"<html>login</html>", request=request))

    response = await client.post(
        ENDPOINT,
        json=call("save_file", {"path": "DDIA.pdf", "url": "https://example.com/ddia.pdf"}),
        headers={**bearer, **RPC},
    )

    assert payload(response.text)["result"]["isError"] is True
    assert "That file is not what its name says" in response.text
    assert empty(agent_vault)
