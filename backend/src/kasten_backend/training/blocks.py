"""The training block notes: every note whose frontmatter `type` is `Training Block`.

The browser reads each note's text; `docs/reference/training/block-note.md` gives the format.
"""

from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend import frontmatter
from kasten_backend.search import skipped
from kasten_backend.vault import note_facts

if TYPE_CHECKING:
    from pathlib import Path

BLOCK_TYPE = "training block"


class TrainingBlock(BaseModel):
    """One block note: its `start` as written and its whole text."""

    path: str
    start: str
    text: str


def _parse(path: str, raw: bytes) -> TrainingBlock | None:
    if not raw.startswith(b"---"):
        return None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if (frontmatter.field(text, "type") or "").lower() != BLOCK_TYPE:
        return None
    return TrainingBlock(path=path, start=frontmatter.field(text, "start") or "", text=text)


def blocks(root: Path, skip: str | None = None) -> list[TrainingBlock]:
    """Every block note outside the `skip` folder, by start, then path."""
    held = note_facts(root, "training-block", _parse, None)
    found = [b for path, b in held.items() if b is not None and not skipped(path, skip)]
    return sorted(found, key=lambda b: (b.start, b.path))
