"""Parts, edits and deletes on a shared list: what each write changes, and every byte it keeps."""

import hashlib
import re
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

BLOCK = (
    "---\n"
    "id: 0190b7a0-0000-7000-8000-000000000001\n"
    "created: 2026-10-01T10:00:00+00:00\n"
    "type: Note\n"
    "modified: 2026-10-01T10:00:00+00:00\n"
    "---\n"
)
"""A frontmatter block a save restamps but does not grow, so the first item sits on line 6."""

DAY = "2026-11-08"


@pytest.fixture
def folder(agent_vault: Path) -> Path:
    """The share folder, empty, in the agent's vault."""
    path = agent_vault / "05 Shared"
    path.mkdir()
    return path


def put(folder: Path, body: str) -> str:
    """Write the list `Todo` as the block and `body`, and return the digest its bytes make."""
    text = BLOCK + body
    (folder / "Todo.md").write_bytes(text.encode("utf-8"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def body(folder: Path) -> str:
    """The list after its frontmatter, which a save restamps."""
    return re.split(r"---\r?\n", (folder / "Todo.md").read_bytes().decode("utf-8"), maxsplit=2)[2]


async def post(client: AsyncClient, write: str, **fields: object) -> dict:
    """One write to `Todo`, which must answer 200, and the list it answers with."""
    response = await client.post(f"/share/lists/Todo/{write}", json=fields)
    assert response.status_code == 200, response.text
    return response.json()


HOUSE = (
    "- [ ] Haus finanzieren\n"
    "  - [ ] Bank anrufen 👤 [[Alicia]]\n"
    "  - [x] Notar ✅ 2026-10-01\n"
    "  - [w] Gutachten 👤 2026-10-20 [[Bert]]\n"
    "    - [ ] Termin\n"
    "- [ ] Brot\n"
)


async def test_a_read_draws_parts_under_their_item_and_no_others(
    client: AsyncClient, folder: Path
) -> None:
    put(folder, HOUSE + "- [/] begonnen\n  - [ ] Teil davon\n## Später\n  - [ ] kein Teil\n")

    items = (await client.get("/share/lists/Todo")).json()["items"]

    assert [(item["line"], item["depth"], item["text"]) for item in items] == [
        (6, 0, "Haus finanzieren"),
        (7, 1, "Bank anrufen"),
        (8, 1, "Notar"),
        (11, 0, "Brot"),
    ]
    assert items[1]["assignee"] == "[[Alicia]]"


async def test_a_tick_takes_the_open_parts_along_as_kasten_does(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, HOUSE)

    await post(client, "tick", line=6, done=True, sha=sha, day=DAY)

    lines = body(folder).split("\n")
    assert re.fullmatch(rf"- \[x\] Haus finanzieren ✅ {DAY} 🆔 kt-[0-9a-f]{{6}}", lines[0])
    assert lines[1:] == [
        f"  - [x] Bank anrufen 👤 [[Alicia]] ✅ {DAY}",
        "  - [x] Notar ✅ 2026-10-01",
        f"  - [x] Gutachten ✅ {DAY}",
        f"    - [x] Termin ✅ {DAY}",
        "- [ ] Brot",
        "",
    ]


async def test_a_part_ticked_alone_leaves_its_item_and_unticks_alone(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, "- [x] Haus ✅ 2026-11-01\n  - [ ] Bank\n  - [x] Notar ✅ 2026-10-01\n")

    found = await post(client, "tick", line=7, done=True, sha=sha, day=DAY)
    await post(client, "tick", line=6, done=False, sha=found["sha"], day=DAY)

    lines = body(folder).split("\n")
    assert lines[0] == "- [ ] Haus"
    assert re.fullmatch(rf"  - \[x\] Bank ✅ {DAY} 🆔 kt-[0-9a-f]{{6}}", lines[1])
    assert lines[2] == "  - [x] Notar ✅ 2026-10-01"


async def test_a_tick_over_a_recurring_part_is_left_to_kasten(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, "- [ ] Haus\n  - [ ] Miete 🔁 every month\n")

    response = await client.post(
        "/share/lists/Todo/tick", json={"line": 6, "done": True, "sha": sha}
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "Tick this one in kasten"}
    assert body(folder) == "- [ ] Haus\n  - [ ] Miete 🔁 every month\n"


async def test_an_add_under_an_item_goes_after_its_parts_two_spaces_in(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, HOUSE)

    found = await post(client, "items", text="  Kredit   prüfen ", sha=sha, under=6)

    assert body(folder) == HOUSE.replace("- [ ] Brot", "  - [ ] Kredit prüfen\n- [ ] Brot")
    assert [item["depth"] for item in found["items"] if item["text"] == "Kredit prüfen"] == [1]


async def test_an_edit_rewrites_the_words_and_keeps_box_indent_fields_and_block_id(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, "- [ ] x\r\n  - [ ] Milch 👤 [[Alicia]] #bio 📅 2026-11-20 🆔 kt-1 ^blk\r\n")

    found = await post(client, "edit", line=7, text="2x  Milch #bio", sha=sha)

    assert (
        body(folder)
        == "- [ ] x\r\n  - [ ] 2x Milch #bio 👤 [[Alicia]] 📅 2026-11-20 🆔 kt-1 ^blk\r\n"
    )
    assert found["items"][1]["text"] == "2x Milch #bio"


@pytest.mark.parametrize("text", ["   ", "📅 2026-11-20"])
async def test_an_edit_that_leaves_no_words_is_refused(
    client: AsyncClient, folder: Path, text: str
) -> None:
    sha = put(folder, "- [ ] Milch\n")

    response = await client.post(
        "/share/lists/Todo/edit", json={"line": 6, "text": text, "sha": sha}
    )

    assert response.status_code == 422
    assert body(folder) == "- [ ] Milch\n"


async def test_an_edit_against_a_stale_digest_is_a_conflict(
    client: AsyncClient, folder: Path
) -> None:
    put(folder, "- [ ] Milch\n")

    response = await client.post(
        "/share/lists/Todo/edit", json={"line": 6, "text": "Brot", "sha": "0"}
    )

    assert response.status_code == 409
    assert body(folder) == "- [ ] Milch\n"


async def test_a_delete_takes_an_item_with_its_parts_and_a_part_alone(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, "Vorher\n" + HOUSE)

    found = await post(client, "delete", line=9, sha=sha)
    assert body(folder) == "Vorher\n" + HOUSE.replace("  - [x] Notar ✅ 2026-10-01\n", "")

    await post(client, "delete", line=7, sha=found["sha"])
    assert body(folder) == "Vorher\n- [ ] Brot\n"


async def test_clear_takes_a_closed_item_whole_and_keeps_open_work(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(
        folder,
        "- [x] fertig\n  - [-] verworfen\n"
        "- [x] halb\n  - [ ] offen\n"
        "- [ ] laufend\n  - [x] Teil fertig\n",
    )

    await post(client, "clear", sha=sha)

    assert body(folder) == "- [x] halb\n  - [ ] offen\n- [ ] laufend\n  - [x] Teil fertig\n"
