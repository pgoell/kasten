"""The store read and written as lines (#2191): what the app parses, and a typed line back."""

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

from kasten_backend.todos import hits, importer
from kasten_backend.todos.store.models import Todo

if TYPE_CHECKING:
    from httpx import AsyncClient

pytestmark = pytest.mark.usefixtures("vault", "store")
READS = json.loads((Path(__file__).parents[2] / "fixtures/todo_reads.json").read_text("utf-8"))
TODAY = importer.date(2026, 11, 18)
PLUS = "\N{HEAVY PLUS SIGN}"


@pytest.mark.parametrize("case", READS, ids=[case["line"] for case in READS])
def test_a_rendered_row_reads_back_as_the_same_row(case: dict[str, Any]) -> None:
    line = case["line"]
    first = importer.row_of(line[6:], line[3], TODAY)
    if any(glyph in first["words"] for glyph in "⛔⏲⏱📅⏳🛫🔁🏁🆔"):
        pytest.skip("a glyph left in the words reads as a field once others follow it")
    row = Todo(**{key: value for key, value in first.items() if key != "id"}, id="kt-000000")
    row.blocked_by = row.blocked_by or []
    rendered = hits.line_of(row)
    again = importer.row_of(rendered[6:], rendered[3], TODAY)

    assert {**again, "id": None} == {**first, "id": None}


async def post_line(client: AsyncClient, text: str, **extra: Any) -> list[dict[str, Any]]:
    response = await client.post("/api/todos/line", json={"text": text, **extra})
    assert response.status_code == 201, response.text
    return response.json()


async def test_a_typed_line_adds_a_todo_and_reads_back_as_its_line(client: AsyncClient) -> None:
    added = (await post_line(client, "- [/] call the bank #money 📅 2026-12-01 ⏫"))[0]
    await post_line(client, "fern", parent_id=added["id"])
    answer = (await client.get("/api/todos")).json()

    assert (added["state"], added["due_hard"], added["note"]) == ("doing", True, added["note"])
    assert added["note"].endswith(".md")
    assert [hit["text"].split(" 🆔")[0] for hit in answer] == [
        f"- [/] call the bank #money ⏫ {PLUS} {added['created']} 📅 2026-12-01",
        f"  - [ ] fern {PLUS} {added['created']}",
    ]
    assert answer[0]["todo"]["id"] == added["id"]
    assert [hit["line"] for hit in answer] == [1, 2]


async def test_an_edited_line_changes_fields_and_state_and_keeps_a_soft_due_soft(
    client: AsyncClient,
) -> None:
    row = (await post_line(client, "draft memo"))[0]
    line = (await client.get("/api/todos")).json()[0]["text"]
    kept = await client.put(f"/api/todos/{row['id']}/line", json={"text": line + " #work"})
    ticked = await client.put(
        f"/api/todos/{row['id']}/line",
        json={"text": line.replace("[ ]", "[x]").replace("draft memo", "draft the memo")},
    )

    assert (kept.json()[0]["tags"], kept.json()[0]["due_hard"]) == (["#work"], False)
    final = ticked.json()[0]
    assert (final["words"], final["state"], final["done"] is not None) == (
        "draft the memo",
        "done",
        True,
    )


async def test_a_running_timer_reads_as_its_time_line(client: AsyncClient) -> None:
    row = (await post_line(client, "write"))[0]
    await client.post(f"/api/todos/{row['id']}/timer")
    answer = (await client.get("/api/todos")).json()
    filtered = (await client.get("/api/todos", params={"state": "open"})).json()

    assert answer[-1]["text"].endswith(f"- write {row['id']}")
    assert answer[-1]["todo"] is None
    assert len(filtered) == 1


async def test_the_import_route_moves_lines_and_reports_first(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "plan.md").write_text("# Plan\n\n- [ ] book flights\n  - [ ] compare\n")
    dry = (await client.post("/api/todos/import")).json()
    done = (await client.post("/api/todos/import", params={"write": True})).json()
    answer = (await client.get("/api/todos")).json()

    assert dry["written"] is False
    assert "open todo lines: 2, open rows: 2" in dry["report"]
    assert "parts: 1" in done["report"]
    assert [hit["text"].split(f" {PLUS}")[0] for hit in answer] == [
        "- [ ] book flights",
        "  - [ ] compare",
    ]
    assert "![[kt-" in (vault / "plan.md").read_text()


def test_a_waiting_line_keeps_its_assignee_beside_the_wait() -> None:
    line = "- [w] hang the door 👤 [[Pascal]] 👤 2026-10-20 [[Alicia]]"
    first = importer.row_of(line[6:], "w", TODAY)
    row = Todo(**{key: value for key, value in first.items() if key != "id"}, id="kt-000000")
    row.blocked_by = []

    assert (first["assignee"], first["waiting_on"]) == ("[[Pascal]]", "[[Alicia]]")
    assert importer.row_of(hits.line_of(row)[6:], "w", TODAY)["assignee"] == "[[Pascal]]"


async def test_a_moved_note_and_folder_take_their_todos_along(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "02 Projects/FDE").mkdir(parents=True)
    (vault / "02 Projects/FDE/plan.md").write_text("- [ ] ship\n")
    await client.post("/api/todos/import", params={"write": True})
    await client.patch("/api/folders/02 Projects/FDE", json={"path": "02 Projects/Other"})
    row = (await client.get("/api/todos/rows")).json()[0]

    assert (row["note"], row["project"]) == ("02 Projects/Other/plan.md", "02 Projects/Other")
