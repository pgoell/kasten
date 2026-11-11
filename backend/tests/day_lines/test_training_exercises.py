"""`GET /api/training/exercises`: the notes whose frontmatter `kind` names an exercise."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

FOLDER = "03 Areas/11 Fitness/Übungen"

SQUAT = """---
type: Reference
kind: strength
aliases: [Squat]
muscles_primary: [quadriceps, gluteal]
muscles_secondary: []
equipment: [Langhantel]
counts: weight-reps
---

# Kniebeuge
"""


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def test_1717_exercise_notes_by_name_with_their_fields(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, f"{FOLDER}/Kniebeuge.md", SQUAT)
    write(vault, f"{FOLDER}/Plank.md", "---\nkind: Mobility\n---\n")
    write(vault, f"{FOLDER}/Knie-zur-Wand.md", "---\nkind: test\nunit: cm\n---\n")
    write(vault, f"{FOLDER}/index.md", "# Übungen\n")
    write(vault, "Notes/Other.md", "---\nkind: essay\n---\n")
    write(vault, "Notes/Body.md", "kind: strength\n")
    write(vault, "98 Archive/Old.md", "---\nkind: strength\n---\n")

    r = await client.get("/api/training/exercises")

    assert r.status_code == 200
    by_name = {e["name"]: e for e in r.json()}
    assert list(by_name) == ["Knie-zur-Wand", "Kniebeuge", "Plank"]
    assert by_name["Kniebeuge"] == {
        "path": f"{FOLDER}/Kniebeuge.md",
        "name": "Kniebeuge",
        "kind": "strength",
        "counts": "weight-reps",
        "aliases": ["Squat"],
        "muscles_primary": ["quadriceps", "gluteal"],
        "muscles_secondary": [],
        "equipment": ["Langhantel"],
    }
    assert (by_name["Plank"]["kind"], by_name["Plank"]["counts"]) == ("mobility", "time")
    assert by_name["Knie-zur-Wand"]["counts"] == "weight-reps"
