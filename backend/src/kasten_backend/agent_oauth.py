"""The authorization server claude.ai and chatgpt.com reach the vault through.

Neither browser product has a field for a header, so the token minted at
`/tokens` cannot be given to either one. Both instead discover an authorization
server, send the user through it, and carry what it issues. This is that server,
and it is small because there is one user and no secret to keep: authorization
code with PKCE, and nothing else.

What it issues is an ordinary row in `tokens.json`, so the gate in
`agent_mcp.py` cannot tell an OAuth grant from a token typed into a terminal and
does not try. `/tokens` revokes both with the same button, and `jj log` names
both the same way. There is one verification path in this vault and this adds no
second one.

The three paths are split across two prefixes on purpose, and Caddy is why:

* `/.well-known/*` and `/agent/oauth/token` are fetched by a machine that has no
  session and no way to get one. They must reach this with no `oauth2_auth` in
  front, or a connector gets a redirect to a sign-in page where it expected
  either a document or a plain 404.
* `/api/oauth/authorize` is opened by your browser, and `oauth2_auth` in front of
  it is what proves who you are. There is no login form here because
  oauth2-proxy already asked, and building a second one would mean a second
  password to lose.

`main.py` registers this router above `app.mount("/agent", ...)`. A mount matches
by prefix, so registered below it `/agent/oauth/token` resolves to the MCP app,
meets the bearer check, and answers 401 to the one caller who by definition has
no token yet.
"""

import base64
import hashlib
import re
import secrets
import time
from html import escape
from typing import Annotated, Any
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from kasten_backend.config import Settings, get_settings
from kasten_backend.tokens import mint, revoke

SCOPE = "kasten:notes"
"""The one scope. It names the five capabilities and there is nothing to narrow."""

RESOURCE = "/agent/mcp"
"""The endpoint being protected, which the metadata names in full."""

METADATA = f"/.well-known/oauth-protected-resource{RESOURCE}"
"""Where RFC 9728 puts the document for a resource whose URL carries a path."""

REDIRECTS = frozenset(
    {
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.com/api/mcp/auth_callback",
        "https://chatgpt.com/connector_platform_oauth_redirect",
    }
)
"""Every address a code may be sent to, matched whole and never by prefix."""

PER_APP = re.compile(r"https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,64}")
"""chatgpt.com's other callback, whose last segment is minted with the app.

It hands out this shape rather than the fixed one above unless the authorization
server proves itself with RFC 9207, and the id is not knowable before the app
exists. The host is pinned by the pattern, so the widening reaches ChatGPT and
nowhere else.
"""

LIFETIME = 60.0
"""Seconds a code is worth anything. The exchange follows the redirect at once."""

GRANT = 315_360_000
"""Ten years, in seconds, and honest: a token here expires when it is revoked.

Stated rather than left out. A client that has to guess prompts you to reconnect
on a schedule of its own choosing.
"""

_codes: dict[str, tuple[str, str, float]] = {}
"""Codes in flight, as `{code: (redirect_uri, challenge, expiry)}`.

In the process and not in Postgres. Nothing here outlives a minute, and a
restart between the redirect and the exchange costs one more press of Connect.
"""

router = APIRouter(include_in_schema=False, tags=["oauth"])
"""Out of the schema: `frontend/openapi.json` describes the browser's API, and
no generated client calls any of this.
"""


def origin(request: Request) -> str:
    """The issuer, which every client compares as an exact string.

    `KASTEN_AGENT_HOST` first. The container runs uvicorn without
    `--forwarded-allow-ips`, so anything built from the request in production
    says `http` where the world sees `https`, and one wrong word there fails
    every comparison downstream.
    """
    named = get_settings().agent_host

    return f"https://{named}" if named else f"{request.url.scheme}://{request.url.netloc}"


def challenge(host: str, secure: bool) -> str:
    """The `WWW-Authenticate` value the MCP endpoint refuses with.

    Called from an ASGI wrapper rather than a route, so it takes the two things
    it needs rather than a request. This one header is what turns a refusal into
    a sign-in: without it a client has nowhere to look and stops.
    """
    named = get_settings().agent_host
    root = f"https://{named}" if named else f"{'https' if secure else 'http'}://{host}"

    return f'Bearer error="invalid_token", resource_metadata="{root}{METADATA}", scope="{SCOPE}"'


def _permitted(redirect_uri: str) -> bool:
    """Whether a code may be sent there at all."""
    return redirect_uri in REDIRECTS or PER_APP.fullmatch(redirect_uri) is not None


def _resource(request: Request) -> dict[str, Any]:
    """RFC 9728, which names the endpoint and points at whoever authorizes it."""
    return {
        "resource": f"{origin(request)}{RESOURCE}",
        "authorization_servers": [origin(request)],
        "scopes_supported": [SCOPE],
    }


@router.get(METADATA)
@router.get("/.well-known/oauth-protected-resource")
async def protected_resource(request: Request) -> dict[str, Any]:
    """Both spellings, because the two products probe different ones.

    Claude follows the path-inserted URL off the 401 header. ChatGPT probes the
    bare one. The document is the same either way, and a 404 on the one a client
    happens to try ends the flow there.
    """
    return _resource(request)


@router.get("/.well-known/oauth-authorization-server")
async def authorization_server(request: Request) -> dict[str, Any]:
    """RFC 8414. Every field here is read by one client or the other.

    `S256` above all: chatgpt.com refuses a server whose metadata omits it,
    before it tries anything. `none` is what lets a client with no secret use the
    token endpoint, which is both of them.
    """
    root = origin(request)

    return {
        "issuer": root,
        "authorization_endpoint": f"{root}/api/oauth/authorize",
        "token_endpoint": f"{root}/agent/oauth/token",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": [SCOPE],
        "authorization_response_iss_parameter_supported": True,
    }


@router.get("/api/oauth/authorize", response_class=HTMLResponse)
async def consent(
    redirect_uri: str = "",
    state: str = "",
    code_challenge: str = "",
    code_challenge_method: str = "",
) -> str:
    """One button, and the reason it is a button rather than a redirect.

    oauth2-proxy's cookie is `SameSite=Lax`, which a browser attaches to a
    top-level navigation. A GET that minted a code would therefore mint one for
    any page that links here, including an attacker's own pending connector flow
    waiting to spend it. A cross-site POST carries no cookie, so oauth2-proxy
    turns it away before this is reached.
    """
    fields = "".join(
        f'<input type=hidden name="{name}" value="{escape(value, quote=True)}">'
        for name, value in (
            ("redirect_uri", redirect_uri),
            ("state", state),
            ("code_challenge", code_challenge),
            ("code_challenge_method", code_challenge_method),
        )
    )

    return (
        "<!doctype html><title>Connect to kasten</title>"
        f"<form method=post>{fields}"
        f"<p>Give {escape(urlsplit(redirect_uri).netloc or 'this client')} the five agent "
        "capabilities: list, read, search, save and append.</p>"
        "<button>Connect</button></form>"
    )


@router.post("/api/oauth/authorize")
async def authorize(
    request: Request,
    redirect_uri: Annotated[str, Form()] = "",
    state: Annotated[str, Form()] = "",
    code_challenge: Annotated[str, Form()] = "",
    code_challenge_method: Annotated[str, Form()] = "S256",
) -> RedirectResponse:
    """Mint a code and send it back to the client that asked.

    Every refusal renders here as a 400 and is never sent on as an error
    redirect. Redirecting to an address this just judged untrusted is the hole it
    is refusing, and the host in question carries a `.pascalkraus.com` session
    cookie.
    """
    if not _permitted(redirect_uri):
        raise HTTPException(status_code=400, detail="That is not an address kasten sends codes to")

    if code_challenge_method != "S256" or not code_challenge:
        raise HTTPException(status_code=400, detail="This issues codes to S256 clients")

    now = time.monotonic()
    for stale, (_, _, expiry) in list(_codes.items()):
        if expiry <= now:
            del _codes[stale]

    code = secrets.token_urlsafe(32)
    _codes[code] = (redirect_uri, code_challenge, now + LIFETIME)

    handed = {"code": code, "state": state, "iss": origin(request)}

    return RedirectResponse(f"{redirect_uri}?{urlencode(handed)}", status_code=302)


@router.post("/agent/oauth/token")
async def token(
    settings: Annotated[Settings, Depends(get_settings)],
    grant_type: Annotated[str, Form()] = "",
    code: Annotated[str, Form()] = "",
    code_verifier: Annotated[str, Form()] = "",
    redirect_uri: Annotated[str, Form()] = "",
) -> JSONResponse:
    """Spend a code once, and mint the token the client will carry.

    Form encoded because RFC 6749 says so, and a JSON-only parser answers 415 to
    every client there is. Every refusal is `invalid_grant`, the RFC 6749 code
    rather than a sentence of ours, because that spelling is what tells a client
    to send the user back through the flow instead of giving up.
    """
    held = _codes.pop(code, None)
    if held is None or grant_type != "authorization_code":
        return JSONResponse({"error": "invalid_grant"}, status_code=400)

    issued_for, challenged, expiry = held
    digested = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    presented = base64.urlsafe_b64encode(digested).rstrip(b"=").decode("ascii")
    if (
        time.monotonic() > expiry
        or issued_for != redirect_uri
        or not secrets.compare_digest(challenged, presented)
    ):
        return JSONResponse({"error": "invalid_grant"}, status_code=400)

    # Named for the product rather than for the grant, so `/tokens` says which
    # one holds what and `jj log` names the writer of every note that arrives
    # through it. A second Connect from the same product is a reconnect, so the
    # old row goes first: `mint` refuses a name the store already holds.
    # ponytail: revoke then mint is two locks rather than one, so two exchanges
    # for the same product landing together would make one of them a 500. One
    # user pressing Connect twice at once is not a case worth a third lock for.
    name = urlsplit(issued_for).hostname or "connector"
    await revoke(settings.tokens_path, name)
    minted = await mint(settings.tokens_path, name)

    return JSONResponse(
        {
            "access_token": minted.secret,
            "token_type": "Bearer",
            "scope": SCOPE,
            "expires_in": GRANT,
        },
        headers={"Cache-Control": "no-store"},
    )
