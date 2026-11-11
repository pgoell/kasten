"""The Anki import routes `main` mounts, one module per part of the import.

`imports` and `routes` are exported as modules so tests patch the names they look up.
"""

from kasten_backend.routes.anki import imports, routes
from kasten_backend.routes.anki.imports import stop
from kasten_backend.routes.anki.routes import router

__all__ = ["imports", "router", "routes", "stop"]
