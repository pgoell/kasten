"""What `GET /api/todos` finds in the vault, and what it refuses to call a todo.

The backend does not parse a todo. It finds the lines that could be one and
hands them over whole, so these tests are about the pattern and nothing else: a
wikilink bullet and an ordered list item look enough like a checkbox to be worth
a test each.
"""

from typing import TYPE_CHECKING

from kasten_backend.todos import MOST_TODOS

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def test_finds_every_state(client: AsyncClient, vault: Path) -> None:
    write(
        vault,
        "projects/kasten.md",
        "# kasten\n- [ ] open\n- [/] doing\n- [x] done\n- [b] blocked\n- [-] rejected\n",
    )

    response = await client.get("/api/todos")

    assert response.status_code == 200
    assert response.json() == [
        {"path": "projects/kasten.md", "line": 2, "text": "- [ ] open"},
        {"path": "projects/kasten.md", "line": 3, "text": "- [/] doing"},
        {"path": "projects/kasten.md", "line": 4, "text": "- [x] done"},
        {"path": "projects/kasten.md", "line": 5, "text": "- [b] blocked"},
        {"path": "projects/kasten.md", "line": 6, "text": "- [-] rejected"},
    ]


async def test_tells_a_todo_from_a_bullet_that_only_looks_like_one(
    client: AsyncClient, vault: Path
) -> None:
    write(
        vault,
        "kasten.md",
        "- [[borges]] and prose\n1. [ ] ordered\n- 09:12-10:32 wire up the pane kt-3f9a2c\n",
    )

    response = await client.get("/api/todos")

    assert [hit["text"] for hit in response.json()] == ["- 09:12-10:32 wire up the pane kt-3f9a2c"]


async def test_finds_a_todo_at_any_indent(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "- [ ] parent\n  - [ ] nested\n")

    response = await client.get("/api/todos")

    assert [hit["line"] for hit in response.json()] == [1, 2]


async def test_answers_with_nothing_for_a_note_holding_neither(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "kasten.md", "# kasten\n\nPostgres holds a derived index.\n")

    response = await client.get("/api/todos")

    assert response.status_code == 200
    assert response.json() == []


async def test_stops_at_the_cap(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "- [ ] open\n" * (MOST_TODOS + 100))

    response = await client.get("/api/todos")

    assert len(response.json()) == MOST_TODOS


async def test_answers_with_nothing_for_a_vault_that_is_not_there(
    client: AsyncClient, missing_vault: Path
) -> None:
    response = await client.get("/api/todos")

    assert response.status_code == 200
    assert response.json() == []
