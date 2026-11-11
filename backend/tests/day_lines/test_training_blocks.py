"""`GET /api/training/blocks`: the notes whose frontmatter `type` is `Training Block`."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

FOLDER = "03 Areas/11 Fitness/Blöcke"


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def test_1719_block_notes_by_start_with_their_text(client: AsyncClient, vault: Path) -> None:
    late = "---\ntype: Training Block\nstart: 2026-12-14\n---\n\n## Days\n- Mon: A\n"
    early = "---\ntype: 'training block'\nstart: 2026-11-16\nweeks: 4\n---\n"
    write(vault, f"{FOLDER}/Block 2026-12.md", late)
    write(vault, f"{FOLDER}/Block 2026-11.md", early)
    write(vault, f"{FOLDER}/Notes.md", "---\ntype: Reference\n---\n")
    write(vault, "Notes/Plain.md", "type: Training Block\n")
    write(vault, "98 Archive/Old.md", "---\ntype: Training Block\nstart: 2025-01-06\n---\n")

    r = await client.get("/api/training/blocks")

    assert r.status_code == 200
    assert r.json() == [
        {"path": f"{FOLDER}/Block 2026-11.md", "start": "2026-11-16", "text": early},
        {"path": f"{FOLDER}/Block 2026-12.md", "start": "2026-12-14", "text": late},
    ]
