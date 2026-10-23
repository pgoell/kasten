"""The backend's copy of the theme stylesheet is the frontend's, byte for byte.

The frontend file is the one kasten's own styles read. The backend copy is what
a page that opts in is given, and what `/api/kasten-theme.css` serves at a path
plugins copy at build time. When this fails, the frontend file changed and the
copy must be renewed: `install -m 644` the frontend file over
`backend/src/kasten_backend/kasten-theme.css`.
"""

from pathlib import Path

ROOT = Path(__file__).parents[2]


def test_the_backend_copy_of_the_theme_is_the_frontend_file() -> None:
    frontend = (ROOT / "frontend" / "src" / "styles" / "kasten-theme.css").read_bytes()
    backend = (ROOT / "backend" / "src" / "kasten_backend" / "kasten-theme.css").read_bytes()

    assert backend == frontend
