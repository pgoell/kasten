"""The MCP surface: the same five capabilities, over JSON-RPC at one endpoint.

The tests here go through the whole application rather than calling the tools,
because every hazard this slice has is in the wiring: where the endpoint answers,
what a mounted app does about its own lifespan, which `Host` gets through, and
whether the writer's name reaches the change the write makes.
"""

import json
from typing import TYPE_CHECKING, Any

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from backend.tests.conftest import JJ, descriptions
from kasten_backend.agent_mcp import INSTRUCTIONS
from kasten_backend.config import get_settings
from kasten_backend.main import app

if TYPE_CHECKING:
    from pathlib import Path

ENDPOINT = "/agent/mcp"
"""Where the endpoint answers, exactly, with no redirect on the way."""

RPC = {
    "content-type": "application/json",
    # Streamable HTTP requires the client to accept both, and the SDK refuses a
    # POST that says otherwise before it looks at anything else.
    "accept": "application/json, text/event-stream",
}


def call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """One JSON-RPC `tools/call` body."""
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }


def payload(body: str) -> dict[str, Any]:
    """The JSON-RPC message in a response, whether it arrived as JSON or as one SSE event."""
    for line in body.splitlines():
        if line.startswith("data: "):
            return json.loads(line.removeprefix("data: "))

    return json.loads(body)


async def test_tools_call_reads_a_note(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")

    response = await client.post(
        ENDPOINT, json=call("read_note", {"path": "borges.md"}), headers={**bearer, **RPC}
    )

    assert response.status_code == 200
    assert payload(response.text)["result"]["structuredContent"]["content"] == "# borges\n"


async def test_no_bearer_is_refused(client: AsyncClient, agent_vault: Path) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")

    response = await client.post(
        ENDPOINT, json=call("read_note", {"path": "borges.md"}), headers=RPC
    )

    assert response.status_code == 401


async def test_the_endpoint_is_exactly_agent_mcp(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # The SDK's app owns `/mcp` internally, so a naive mount nests the endpoint
    # one level deeper and answers the documented URL with a 307 many clients
    # will not follow on a POST.
    (agent_vault / "borges.md").write_text("# borges\n")

    response = await client.post(
        ENDPOINT,
        json=call("read_note", {"path": "borges.md"}),
        headers={**bearer, **RPC},
        follow_redirects=False,
    )

    assert response.status_code == 200


@pytest.mark.parametrize("method", ["GET", "DELETE"])
async def test_get_and_delete_are_refused(
    client: AsyncClient, bearer: dict[str, str], method: str
) -> None:
    # Streamable HTTP defines all three on the endpoint. The stateless
    # configuration needs only POST, so the other two are a decision rather than
    # an accident. A timeout rather than the client's default, because the
    # failure this guards against is a `GET` that opens a stream and holds it:
    # unbounded, that is a suite that stalls instead of one that fails.
    response = await client.request(method, ENDPOINT, headers={**bearer, **RPC}, timeout=5.0)

    assert response.status_code == 405
    assert response.headers["allow"] == "POST"


async def test_the_production_host_is_accepted(
    agent_vault: Path, token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Both halves are needed. An allowlist wired wrong enough to refuse
    # everything passes the refusal below on its own, and the deploy curls hit
    # the REST routes only, so a 421-on-everything endpoint would surface first
    # in production.
    (agent_vault / "borges.md").write_text("# borges\n")
    monkeypatch.setenv("KASTEN_AGENT_HOST", "kasten.pascalkraus.com")
    get_settings.cache_clear()

    async with (
        LifespanManager(app),
        AsyncClient(
            transport=ASGITransport(app=app), base_url="http://kasten.pascalkraus.com"
        ) as gated,
    ):
        response = await gated.post(
            ENDPOINT,
            json=call("read_note", {"path": "borges.md"}),
            headers={"Authorization": f"Bearer {token}", **RPC},
        )

    assert response.status_code == 200


async def test_a_foreign_host_is_refused(
    agent_vault: Path, token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")
    monkeypatch.setenv("KASTEN_AGENT_HOST", "kasten.pascalkraus.com")
    get_settings.cache_clear()

    async with (
        LifespanManager(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://attacker.example") as gated,
    ):
        response = await gated.post(
            ENDPOINT,
            json=call("read_note", {"path": "borges.md"}),
            headers={"Authorization": f"Bearer {token}", **RPC},
        )

    assert response.status_code == 421


@pytest.mark.skipif(JJ is None, reason="jj is not installed")
async def test_an_mcp_write_is_named_in_the_log(
    client: AsyncClient, versioned_agent_vault: Path, bearer: dict[str, str]
) -> None:
    # `require_token` is a FastAPI dependency and does not reach a mounted app,
    # so without the wrapper's own set and reset every MCP write would land as
    # `vault: {path}` with the whole suite still green.
    response = await client.post(
        ENDPOINT,
        json=call("save_note", {"path": "borges.md", "content": "# from the agent"}),
        headers={**bearer, **RPC},
    )

    assert response.status_code == 200
    assert descriptions(versioned_agent_vault) == ["agent(laptop): borges.md"]


async def test_two_lifespan_entries_succeed(agent_vault: Path, token: str) -> None:
    # The session manager is single-use, so the app is built inside the lifespan
    # and each entry builds a fresh one. One end-to-end test cannot prove a
    # second entry works, and a reload in dev is a second entry.
    (agent_vault / "borges.md").write_text("# borges\n")

    for _ in range(2):
        async with (
            LifespanManager(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as entered,
        ):
            response = await entered.post(
                ENDPOINT,
                json=call("read_note", {"path": "borges.md"}),
                headers={"Authorization": f"Bearer {token}", **RPC},
            )

            assert response.status_code == 200
            # `endswith` rather than equality: the lifespan's own type backfill
            # runs on the way in and stamps the block above the body.
            assert payload(response.text)["result"]["structuredContent"]["content"].endswith(
                "# borges\n"
            )


async def test_a_conflict_reaches_the_client_as_a_tool_error(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # The same sentence the 409 body carries, so both surfaces refuse in the
    # same words.
    (agent_vault / "borges.md").write_text("# borges\n")

    response = await client.post(
        ENDPOINT,
        json=call("save_note", {"path": "borges.md", "content": "# gone"}),
        headers={**bearer, **RPC},
    )

    assert "The note changed since you read it" in response.text
    assert payload(response.text)["result"]["isError"] is True


async def test_the_reading_tools_say_so(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # Spelled `readOnlyHint` on the wire, whatever the SDK calls the field.
    # chatgpt.com asks the user to confirm every call to a tool without it, so
    # an unannotated `read_note` turns a search across the vault into one button
    # press per note.
    response = await client.post(
        ENDPOINT,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={**bearer, **RPC},
    )

    hints = {
        tool["name"]: tool["annotations"]["readOnlyHint"]
        for tool in payload(response.text)["result"]["tools"]
    }

    assert hints == {
        "list_notes": True,
        "read_note": True,
        "search_notes": True,
        "read_guide": True,
        "save_note": False,
        "append_note": False,
    }


async def test_the_guide_reaches_a_client_that_reads_instructions(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # Claude Code, codex and ChatGPT read this field. It rides the handshake, so
    # a model has it before it chooses a first call.
    response = await client.post(
        ENDPOINT,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "1"},
            },
        },
        headers={**bearer, **RPC},
    )

    instructions = payload(response.text)["result"]["instructions"]

    assert "There is no grep" in instructions
    assert "Do not call it" in instructions


async def test_the_guide_reaches_a_client_that_drops_them(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # claude.ai and Claude Desktop discard the field above, and `tools/list` is
    # the path no client drops. Same text, minus the line telling a reader who
    # already has it not to ask.
    response = await client.post(ENDPOINT, json=call("read_guide", {}), headers={**bearer, **RPC})

    guide = payload(response.text)["result"]["content"][0]["text"]

    assert "There is no grep" in guide
    assert "Do not call it" not in guide


async def test_the_guide_touches_no_note(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # A sixth tool and not a sixth capability. What comes back is the string
    # compiled into the server, whole, so no read of the vault stands behind it.
    response = await client.post(ENDPOINT, json=call("read_guide", {}), headers={**bearer, **RPC})

    assert payload(response.text)["result"]["content"][0]["text"] == INSTRUCTIONS
