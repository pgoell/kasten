"""What the vault's todo lines read as, the way `GET /api/todos` answered before the store (#2191).

The import and the line reader still read lines, so their tests keep asking this.
"""

from dataclasses import dataclass
from typing import Any

from kasten_backend.config import get_settings
from kasten_backend.main import app
from kasten_backend.share import inside
from kasten_backend.todos import find_todos, projects_of
from kasten_backend.vault import list_markdown_files


@dataclass
class Answer:
    """A stand-in for a response: the rows and a 200."""

    rows: list[dict[str, Any]]
    status_code: int = 200

    def json(self) -> list[dict[str, Any]]:
        return self.rows


async def lines(_client: object, params: dict[str, Any] | None = None) -> Answer:
    """Every todo and running session line in the served vault, each with its project."""
    settings = app.dependency_overrides.get(get_settings, get_settings)()
    archive = (params or {}).get("archive") in ("true", True)
    hits = await find_todos(settings.vault_path, None if archive else settings.archive_path)
    projects = projects_of(hits, list_markdown_files(settings.vault_path))
    return Answer(
        [
            {
                "path": hit.path,
                "line": hit.line,
                "text": hit.text,
                "project": project,
                "shared": inside(settings, hit.path),
            }
            for hit, project in zip(hits, projects, strict=True)
        ]
    )
