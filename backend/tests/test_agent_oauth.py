"""The OAuth flow the browser products connect through.

claude.ai and chatgpt.com have no field for a header, so a token minted at
`/tokens` cannot reach them. They discover an authorization server, send the
user through it, and carry what it issues. What it issues here is an ordinary
row in the same token store, so everything below ends at the same gate the
header clients meet.

The hazards are all in the wiring, so these go through the whole application:
where a route is registered relative to the mount, what a machine with no
session gets, and whether a code can be spent twice.
"""

import base64
import hashlib
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlsplit

from backend.tests.test_mcp import ENDPOINT, RPC, call
from kasten_backend.agent_routes import BEARER

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

VERIFIER = "a" * 64
"""One PKCE verifier, long enough for RFC 7636 and otherwise unremarkable."""

CHALLENGE = (
    base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode("utf-8")).digest())
    .rstrip(b"=")
    .decode("ascii")
)

CLAUDE = "https://claude.ai/api/mcp/auth_callback"


def consent(redirect_uri: str = CLAUDE, challenge: str = CHALLENGE) -> dict[str, str]:
    """The form the consent page posts back, which is where a code comes from."""
    return {
        "redirect_uri": redirect_uri,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "opaque-to-us",
    }


def exchange(code: str, verifier: str = VERIFIER, redirect_uri: str = CLAUDE) -> dict[str, str]:
    """The form the token endpoint takes, which RFC 6749 says is not JSON."""
    return {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": verifier,
        "redirect_uri": redirect_uri,
    }


async def code_from(client: AsyncClient, **kwargs: Any) -> str:
    """Walk the consent step and hand back the code it redirected with."""
    response = await client.post(
        "/api/oauth/authorize", data=consent(**kwargs), follow_redirects=False
    )

    assert response.status_code == 302

    return parse_qs(urlsplit(response.headers["location"]).query)["code"][0]


async def test_the_metadata_needs_no_bearer(client: AsyncClient, agent_vault: Path) -> None:
    # A machine with no session and no token fetches these, and it is the only
    # way it learns where to send the user. Behind either gate they are useless.
    for path in (
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/agent/mcp",
        "/.well-known/oauth-authorization-server",
    ):
        response = await client.get(path)

        assert response.status_code == 200, path


async def test_the_resource_is_named_exactly_as_it_is_typed(
    client: AsyncClient, agent_vault: Path
) -> None:
    # Compared as a string by both clients, path included. A resource that says
    # the origin while the user typed the endpoint fails the whole flow.
    response = await client.get("/.well-known/oauth-protected-resource/agent/mcp")

    assert response.json()["resource"] == "http://test/agent/mcp"


async def test_the_metadata_promises_s256(client: AsyncClient, agent_vault: Path) -> None:
    # chatgpt.com refuses a server whose metadata omits this, before anything
    # else happens.
    metadata = (await client.get("/.well-known/oauth-authorization-server")).json()

    assert metadata["code_challenge_methods_supported"] == ["S256"]
    assert metadata["issuer"] == "http://test"


async def test_the_mcp_401_points_at_the_metadata(client: AsyncClient, agent_vault: Path) -> None:
    # The one thing that turns a refusal into a sign-in. Without it a client has
    # nothing to discover and stops.
    response = await client.post(ENDPOINT, json=call("list_notes", {}), headers=RPC)

    assert response.status_code == 401
    assert (
        'resource_metadata="http://test/.well-known/oauth-protected-resource/agent/mcp"'
        in response.headers["www-authenticate"]
    )


async def test_a_code_becomes_a_token_that_reaches_the_vault(
    client: AsyncClient, agent_vault: Path
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")

    granted = await client.post("/agent/oauth/token", data=exchange(await code_from(client)))

    assert granted.status_code == 200
    # The scheme the gate accepts, off the gate rather than spelled again.
    assert granted.json()["token_type"] == BEARER.strip()

    read = await client.post(
        ENDPOINT,
        json=call("read_note", {"path": "borges.md"}),
        headers={"Authorization": f"Bearer {granted.json()['access_token']}", **RPC},
    )

    assert read.status_code == 200


async def test_the_token_endpoint_is_reachable_without_a_token(
    client: AsyncClient, agent_vault: Path
) -> None:
    # It lives under `/agent/`, which the mount claims by prefix. Registered
    # below the mount it answers 401 to a caller who by definition has no token
    # yet, and the flow ends one step from the end.
    response = await client.post("/agent/oauth/token", data=exchange("not-a-code"))

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_grant"


async def test_a_code_is_spent_by_its_first_exchange(
    client: AsyncClient, agent_vault: Path
) -> None:
    code = await code_from(client)
    assert (await client.post("/agent/oauth/token", data=exchange(code))).status_code == 200

    replayed = await client.post("/agent/oauth/token", data=exchange(code))

    assert replayed.status_code == 400


async def test_a_wrong_verifier_is_refused(client: AsyncClient, agent_vault: Path) -> None:
    # PKCE is the whole of what guards a code in flight, since the client holds
    # no secret.
    code = await code_from(client)

    response = await client.post("/agent/oauth/token", data=exchange(code, verifier="b" * 64))

    assert response.status_code == 400


async def test_a_code_is_bound_to_the_address_it_was_issued_for(
    client: AsyncClient, agent_vault: Path
) -> None:
    code = await code_from(client)

    response = await client.post(
        "/agent/oauth/token",
        data=exchange(code, redirect_uri="https://chatgpt.com/connector_platform_oauth_redirect"),
    )

    assert response.status_code == 400


async def test_an_unregistered_address_is_refused_without_redirecting(
    client: AsyncClient, agent_vault: Path
) -> None:
    # Never as an error redirect. Sending anything to an address just judged
    # untrusted is the hole this is refusing, and the host carries a
    # .pascalkraus.com session cookie.
    response = await client.post(
        "/api/oauth/authorize",
        data=consent(redirect_uri="https://attacker.example/callback"),
        follow_redirects=False,
    )

    assert response.status_code == 400
    assert "location" not in response.headers


async def test_plain_pkce_is_refused(client: AsyncClient, agent_vault: Path) -> None:
    response = await client.post(
        "/api/oauth/authorize",
        data={**consent(), "code_challenge_method": "plain"},
        follow_redirects=False,
    )

    assert response.status_code == 400


async def test_chatgpts_per_app_callback_is_accepted(
    client: AsyncClient, agent_vault: Path
) -> None:
    # It hands out `/connector/oauth/{callback_id}` unless the issuer proves
    # itself, and the id is not known until the app exists.
    code = await code_from(client, redirect_uri="https://chatgpt.com/connector/oauth/abc123")

    assert code


async def test_a_grant_is_named_for_the_client_it_went_to(
    client: AsyncClient, agent_vault: Path
) -> None:
    # So `/tokens` lists which product holds what, and `jj log` names the writer
    # of every note that arrives through one.
    await client.post("/agent/oauth/token", data=exchange(await code_from(client)))

    assert [token["name"] for token in (await client.get("/api/tokens")).json()] == ["claude.ai"]


async def test_connecting_twice_replaces_the_grant(client: AsyncClient, agent_vault: Path) -> None:
    # A second Connect from the same product is a reconnect, not a second token
    # the store cannot mint because the name is taken.
    first = await client.post("/agent/oauth/token", data=exchange(await code_from(client)))
    second = await client.post("/agent/oauth/token", data=exchange(await code_from(client)))

    assert second.status_code == 200
    assert second.json()["access_token"] != first.json()["access_token"]

    stale = await client.post(
        ENDPOINT,
        json=call("list_notes", {}),
        headers={"Authorization": f"Bearer {first.json()['access_token']}", **RPC},
    )

    assert stale.status_code == 401


async def test_the_consent_page_is_a_form_rather_than_a_redirect(
    client: AsyncClient, agent_vault: Path
) -> None:
    # A GET that mints a code is issuable by a link, and the oauth2-proxy cookie
    # is SameSite=Lax, so it rides a top-level navigation. The POST is what an
    # attacker's page cannot make the browser send.
    response = await client.get(f"/api/oauth/authorize?redirect_uri={CLAUDE}&state=x")

    assert response.status_code == 200
    assert "<form method=post" in response.text
