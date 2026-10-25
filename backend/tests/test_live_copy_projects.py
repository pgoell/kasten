"""Todo counts per project over a read-only copy of the live vault, for #809 A3.

Off unless `KASTEN_LIVE_COPY` names the copy. `KASTEN_LIVE_OUT` is where the
JSON goes, so main and the branch can be diffed line by line.
"""

import json
import os
from collections import Counter
from pathlib import Path

import pytest

from kasten_backend import todos
from kasten_backend.vault import list_markdown_files

LIVE_COPY = os.environ.get("KASTEN_LIVE_COPY", "")
LIVE_OUT = os.environ.get("KASTEN_LIVE_OUT", "")
ARCHIVE = "98 Archive"


@pytest.mark.skipif(not LIVE_COPY, reason="needs KASTEN_LIVE_COPY set to a copy of a vault")
async def test_809_a3_todo_counts_per_project_of_the_live_copy() -> None:
    root = Path(LIVE_COPY)
    hits = await todos.find_todos(root, ARCHIVE)
    projects = todos.projects_of(hits, list_markdown_files(root))

    per_project: Counter[str] = Counter(project or "none" for project in projects)
    with_person = []
    for hit in hits:
        if "👤" not in hit.text:
            continue
        rest = todos.LINE.fullmatch(hit.text)
        words = todos._words(rest[2] or "") if rest else None
        with_person.append({"path": hit.path, "line": hit.line, "words": words})

    _write_json(
        {
            "perProject": dict(per_project),
            "withPerson": len(with_person),
            "personLines": with_person,
            "total": len(hits),
        }
    )
    assert len(hits) > 0


def _write_json(data: dict[str, object]) -> None:
    # Sync on purpose: ruff's ASYNC230/240 flag a file write in the async test.
    Path(LIVE_OUT).write_text(json.dumps(data, ensure_ascii=False, indent=1))
