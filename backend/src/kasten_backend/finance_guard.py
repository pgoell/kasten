"""Two checks in front of every finance write: from kasten's own page, and not too big.

Own site: a write whose `Sec-Fetch-Site` (or `Origin`, if that is missing) names another site
gets a `403`; the host jobs send neither and pass. Size: bytes are counted as they arrive,
since FastAPI writes the body to disk first. Over the cap gets a `413`.
"""

import json
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from starlette.exceptions import HTTPException

from kasten_backend.finance_receipts import MAX_BYTES, MAX_SHARED

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

ROOM = 64 * 1024
"""The form around the files: field names, boundaries, the share's text."""

CAPS: dict[str, int] = {
    "/api/finance/receipts": MAX_BYTES + ROOM,
    "/api/finance/receipts/share": MAX_SHARED * MAX_BYTES + ROOM,
}
"""The most bytes a POST to each path may carry."""

TOO_BIG = "That is more than a receipt post may carry"


READS = {"GET", "HEAD", "OPTIONS"}

PREFIX = "/api/finance/"


def _from_elsewhere(headers: dict[bytes, bytes]) -> bool:
    """Whether a browser says another site sent this request."""
    site = headers.get(b"sec-fetch-site")
    if site is not None:
        return site not in (b"same-origin", b"none")
    sent = headers.get(b"origin")
    return sent is not None and urlsplit(sent.decode("latin-1")).netloc.encode() != headers.get(
        b"host"
    )


class FinanceGuard:
    """ASGI middleware: own-site writes only under `/api/finance/`, and the receipt caps."""

    def __init__(self, app: ASGIApp) -> None:
        """Wrap the app."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Pass everything through but a write from elsewhere and a receipt post over its cap."""
        path = scope.get("path", "") if scope["type"] == "http" else ""
        if not path.startswith(PREFIX) or scope.get("method") in READS:
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        if _from_elsewhere(headers):
            await _refuse(send, 403, "A finance write comes from kasten's own page")
            return
        cap = CAPS.get(path) if scope.get("method") == "POST" else None
        if cap is None:
            await self.app(scope, receive, send)
            return
        declared = headers.get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > cap:
            await _refuse(send, 413, TOO_BIG)
            return
        seen = 0

        async def counted() -> Message:
            nonlocal seen
            message = await receive()
            seen += len(message.get("body", b""))
            if seen > cap:
                # Raised inside the form parse, which FastAPI passes on as it is.
                raise HTTPException(status_code=413, detail=TOO_BIG)
            return message

        await self.app(scope, counted, send)


async def _refuse(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
