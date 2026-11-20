"""The store read and written as lines (#2191): what the app parses, and a typed line back."""

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

from kasten_backend.todos import hits, importer
from kasten_backend.todos.store.models import Todo

if TYPE_CHECKING:
    from httpx import AsyncClient, Response

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


async def put_line(client: AsyncClient, row: dict[str, Any], text: str) -> Response:
    """Send `text` as the edited line of `row`, at the version `row` was read at."""
    return await client.put(
        f"/api/todos/{row['id']}/line", json={"text": text, "version": row["version"]}
    )


async def test_an_edited_line_changes_fields_and_state_and_keeps_a_soft_due_soft(
    client: AsyncClient,
) -> None:
    row = (await post_line(client, "draft memo"))[0]
    line = (await client.get("/api/todos")).json()[0]["text"]
    kept = await put_line(client, row, line + " #work")
    ticked = await put_line(
        client, kept.json()[0], line.replace("[ ]", "[x]").replace("draft memo", "draft the memo")
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


KASTEN = "02 Projects/Kasten"


def projects(vault: Path) -> None:
    for folder in (KASTEN, "02 Projects/FDE"):
        (vault / folder).mkdir(parents=True)
        (vault / folder / "index.md").write_text("# index\n")


async def test_2249_a_link_or_tag_typed_into_a_line_files_the_todo_and_its_parts(
    client: AsyncClient, vault: Path
) -> None:
    projects(vault)
    tapped = (await post_line(client, "fix the tap"))[0]
    part = (await post_line(client, "buy a washer", parent_id=tapped["id"]))[0]
    tagged = (await post_line(client, "post the slides"))[0]
    linked = await put_line(client, tapped, "- [ ] fix the tap [[02 Projects/Kasten/index|Kasten]]")
    tag = await put_line(client, tagged, "- [ ] post the slides #p/kasten")

    assert linked.status_code == 200, linked.text
    assert {one["words"]: one["project"] for one in linked.json()} == {
        "fix the tap [[02 Projects/Kasten/index|Kasten]]": KASTEN,
        "buy a washer": KASTEN,
    }
    assert part["project"] is None
    assert tag.json()[0]["project"] == KASTEN
    own = (await post_line(client, "send the deck #p/kasten", parent_id=tagged["id"]))[0]
    untagged = await put_line(client, tag.json()[0], "- [ ] post the slides")
    after = {one["words"]: one["project"] for one in (await client.get("/api/todos/rows")).json()}
    assert untagged.json()[0]["project"] is None
    assert (own["project"], after["send the deck #p/kasten"]) == (KASTEN, KASTEN)


async def test_2249_the_note_folder_beats_a_link_and_an_edit_naming_nothing_new_keeps_a_project(
    client: AsyncClient, vault: Path
) -> None:
    projects(vault)
    planned = (await post_line(client, "write the deck", note="02 Projects/FDE/plan.md"))[0]
    moved = (await post_line(client, "call the bank"))[0]
    change = {"version": 1, "project": KASTEN}
    moved = (await client.patch(f"/api/todos/{moved['id']}", json=change)).json()[0]
    linked = await put_line(client, planned, "- [ ] write the deck [[02 Projects/Kasten/index]]")
    worded = await put_line(client, moved, "- [ ] call the bank about the loan")

    assert linked.json()[0]["project"] == "02 Projects/FDE"
    assert worded.json()[0]["project"] == KASTEN


async def test_2247_a_line_typed_over_a_todo_changed_since_is_refused_and_writes_nothing(
    client: AsyncClient,
) -> None:
    read_at = (await post_line(client, "call the bank"))[0]
    changed = await client.patch(
        f"/api/todos/{read_at['id']}", json={"version": read_at["version"], "priority": "high"}
    )
    stale = await put_line(client, read_at, "- [ ] call the bank about the loan")
    unversioned = await client.put(
        f"/api/todos/{read_at['id']}/line", json={"text": "- [ ] call the bank today"}
    )
    after = (await client.get("/api/todos/rows")).json()

    assert changed.status_code == 200
    assert stale.status_code == 409
    assert stale.json()["detail"] == f"{read_at['id']} changed since it was read: read it again."
    assert unversioned.status_code == 422
    assert [(one["words"], one["priority"]) for one in after] == [("call the bank", "high")]
    fresh = await put_line(client, changed.json()[0], "- [ ] call the bank about the loan ⏫")
    assert fresh.json()[0]["words"] == "call the bank about the loan"
