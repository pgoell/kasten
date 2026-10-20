"""The docs that were split for the file-size limit, each with its folder of pages.

A split page keeps its name and gets a folder beside it that holds the parts.
This checks that every split landed and that each page and part is under the
same limit scripts/file_size.py enforces (#611).
"""

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).parents[2]
DOCS = REPO / "docs"
SCRIPT = REPO / "scripts" / "file_size.py"

PAGES = [
    "log.md",
    "reference/editor-keys.md",
    "reference/http-api.md",
    "reference/save-path-orderings.md",
    "reference/todo-format.md",
    "reference/flashcard-format.md",
    "reference/agent-api.md",
    "explanation/books-in-the-vault.md",
    "explanation/live-preview.md",
]


def test_each_split_page_and_its_folder_are_under_the_limit() -> None:
    checked = []
    for name in PAGES:
        page = DOCS / name
        folder = DOCS / name.removesuffix(".md")
        assert page.is_file(), f"{name} is missing"
        assert folder.is_dir(), f"{name} has no folder {folder.name}/"
        parts = sorted(folder.rglob("*.md"))
        assert len(parts) >= 2, f"{folder.name}/ holds {len(parts)} pages, want at least 2"
        checked += [page, *parts]

    # The script's own rule decides the size, so a failure names the page over.
    result = subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT), *(str(path.relative_to(REPO)) for path in checked)],
        capture_output=True,
        text=True,
        cwd=REPO,
        check=False,
    )
    assert result.returncode == 0, result.stdout
