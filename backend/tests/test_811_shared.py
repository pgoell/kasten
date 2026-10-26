"""The `shared` flag `GET /api/todos` gives each todo, by the rule `share.inside` reads.

A todo is shared when its note sits directly in the share folder. A note deeper
down, or in a folder whose name only starts with `05 Shared`, is not a list.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def shared_by_text(client: AsyncClient) -> dict[str, bool]:
    """Each todo line's `shared` flag, keyed by its text."""
    response = await client.get("/api/todos")
    assert response.status_code == 200
    return {hit["text"]: hit["shared"] for hit in response.json()}


async def test_811_a10_a_todo_in_the_share_folder_is_shared(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "05 Shared/Einkauf.md", "- [ ] milk\n")

    assert (await shared_by_text(client))["- [ ] milk"] is True


async def test_811_a10_a_todo_elsewhere_or_deeper_is_not_shared(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "05 Shared/sub/x.md", "- [ ] deep\n")
    write(vault, "05 Sharedx/a.md", "- [ ] sibling\n")
    write(vault, "02 Projects/FDE/plan.md", "- [ ] work\n")

    found = await shared_by_text(client)

    assert found["- [ ] deep"] is False
    assert found["- [ ] sibling"] is False
    assert found["- [ ] work"] is False
