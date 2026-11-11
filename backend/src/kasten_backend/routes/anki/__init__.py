"""The Anki import routes `main` mounts, one module per part of the import."""

from kasten_backend.routes.anki.routes import router

__all__ = ["router"]
