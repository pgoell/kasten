"""What a token holder may do: the vault capabilities, the `/agent/` routes, MCP and OAuth.

`capabilities` holds the rules with no HTTP, `route` and `mcp_server` the two surfaces
over it, `oauth` the sign-in for browser products. The modules are exported so tests
patch the names they look up.
"""

from kasten_backend.agent import capabilities, finance, mcp_server, oauth, route
from kasten_backend.agent.capabilities import (
    NOTHING,
    Capture,
    ConflictError,
    EmptyCaptureError,
    TooLargeError,
    digest,
    dump,
    read_note,
    save_note,
)
from kasten_backend.agent.mcp_server import INSTRUCTIONS, REDUNDANT, instructions
from kasten_backend.agent.oauth import router as oauth_router
from kasten_backend.agent.route import (
    BEARER,
    note_changed,
    nothing_to_capture,
    reading_router,
    refused,
    router,
    too_large,
)

__all__ = [
    "BEARER",
    "INSTRUCTIONS",
    "NOTHING",
    "REDUNDANT",
    "Capture",
    "ConflictError",
    "EmptyCaptureError",
    "TooLargeError",
    "capabilities",
    "digest",
    "dump",
    "finance",
    "instructions",
    "mcp_server",
    "note_changed",
    "nothing_to_capture",
    "oauth",
    "oauth_router",
    "read_note",
    "reading_router",
    "refused",
    "route",
    "router",
    "save_note",
    "too_large",
]
