"""The authorization server claude.ai and chatgpt.com reach the vault through.

Issues an ordinary `tokens.json` row, so the bearer gate treats a grant like a typed token.
Caddy leaves `/.well-known/*` and `/agent/oauth/token` without `oauth2_auth`. Register this
router above `app.mount("/agent")` in `main.py`, or the mount answers its 401 first.
"""

import base64
import hashlib
import re
import secrets
import time
from html import escape
from typing import Annotated, Any
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from kasten_backend.config import Settings, get_settings
from kasten_backend.tokens import mint, revoke

SCOPE = "kasten:notes"
"""The one scope. It names the eight capabilities and the finance reads, and narrows nothing."""

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

It sends this shape, not the fixed one above, unless the server proves itself with
RFC 9207. The pattern pins the host, so the widening reaches ChatGPT only.
"""

CHALLENGE = re.compile(r"[A-Za-z0-9_-]{43,128}")
"""The shape RFC 7636 gives a challenge, matched whole.

Anything else could never match a verifier, and non-ASCII text here once made the
exchange a 500 (#1228).
"""

LIFETIME = 60.0
"""Seconds a code is worth anything. The exchange follows the redirect at once."""

GRANT = 315_360_000
"""Ten years, in seconds, and honest: a token here expires when it is revoked.

Stated, not left out: a client that has to guess prompts you to reconnect on its own schedule.
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

    `KASTEN_AGENT_HOST` first: uvicorn runs without `--forwarded-allow-ips`, so a URL built
    from the request says `http` where the world sees `https`.
    """
    named = get_settings().agent_host

    return f"https://{named}" if named else f"{request.url.scheme}://{request.url.netloc}"


def challenge(host: str, secure: bool) -> str:
    """The `WWW-Authenticate` value the MCP endpoint refuses with.

    Called from an ASGI wrapper, so it takes the host and scheme, not a request. Without
    this header a client has nowhere to sign in.
    """
    named = get_settings().agent_host
    root = f"https://{named}" if named else f"{'https' if secure else 'http'}://{host}"

    return f'Bearer error="invalid_token", resource_metadata="{root}{METADATA}", scope="{SCOPE}"'


def _permitted(redirect_uri: str) -> bool:
    """Whether a code may be sent there at all."""
    return redirect_uri in REDIRECTS or PER_APP.fullmatch(redirect_uri) is not None


def _same_origin(request: Request) -> bool:
    """Whether the consent POST came from kasten's own page and not another site's.

    `Sec-Fetch-Site` settles it when present, since no page can set it. Without it, an
    `Origin` must match the `Host` it reached, or `KASTEN_AGENT_HOST`. A request with
    neither came from no browser. Behind basic auth nothing else stops a cross-site POST.
    """
    site = request.headers.get("sec-fetch-site")
    if site is not None:
        return site == "same-origin"

    sent = request.headers.get("origin")
    if sent is None:
        return True

    try:
        host = urlsplit(sent).netloc
    except ValueError:
        # `http://[` and its kind, which no browser sends: a refusal, not a 500
        # (#1230).
        return False

    named = get_settings().agent_host
    return host == request.headers.get("host") or (bool(named) and sent == f"https://{named}")


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
    token endpoint, which is both of them. chatgpt.com wants a way to get a
    `client_id` too, and with neither this flag nor a registration endpoint its
    add dialog will not submit. The flag lets it send the URL of its own client
    document as the id; kasten never fetches it, since the redirect allowlist,
    not the client, is what decides where a code goes.
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
        "client_id_metadata_document_supported": True,
    }


@router.get("/api/oauth/authorize", response_class=HTMLResponse)
async def consent(
    response: Response,
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
    turns it away before this is reached, and `_same_origin` refuses it behind
    a proxy that does not.

    An address the POST would refuse is refused here first, so the page never
    names a host no code goes to, and `urlsplit` below only ever meets one of
    the allowed addresses: on anything else it can raise (#1230).
    """
    if not _permitted(redirect_uri):
        raise HTTPException(status_code=400, detail="That is not an address kasten sends codes to")

    # Frame-blocking stops a site steering a click on this page (#870). `'self'` would
    # let an epub chapter frame it, so `'none'`.
    response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"

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
        f"<p>Give {escape(urlsplit(redirect_uri).netloc)} the eight agent "
        "capabilities: list, read, search, graph, save, append, dump and file, "
        "and every finance figure and transaction, to read.</p>"
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
    is refusing, and the host in question may carry the gate's session
    cookie.
    """
    if not _same_origin(request):
        raise HTTPException(status_code=403, detail="Connect from kasten's own consent page")

    if not _permitted(redirect_uri):
        raise HTTPException(status_code=400, detail="That is not an address kasten sends codes to")

    if code_challenge_method != "S256" or CHALLENGE.fullmatch(code_challenge) is None:
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
        # Bytes, because `compare_digest` raises on non-ASCII text and a 500 is
        # not a refusal a client acts on (#1228).
        or not secrets.compare_digest(challenged.encode("utf-8"), presented.encode("ascii"))
    ):
        return JSONResponse({"error": "invalid_grant"}, status_code=400)

    # Named for the product, so `/tokens` and `jj log` say who wrote what. A reconnect
    # revokes the old row first, since `mint` refuses a name already held.
    # ponytail: revoke then mint is two locks, so racing exchanges for one product could 500.
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
