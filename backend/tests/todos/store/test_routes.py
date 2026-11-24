"""The todo store's routes (#2191): add, change, states and what they drag along, timer, history."""

from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncEngine

pytestmark = pytest.mark.usefixtures("vault", "store")


def today() -> date:
    return datetime.now(ZoneInfo("Europe/Berlin")).date()


async def add(client: AsyncClient, words: str, **fields: Any) -> dict[str, Any]:
    response = await client.post("/api/todos", json={"words": words, **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def rows(client: AsyncClient, archive: bool = False) -> dict[str, dict[str, Any]]:
    response = await client.get("/api/todos/rows", params={"archive": archive})
    return {row["words"]: row for row in response.json()}


async def state(client: AsyncClient, id_: str, to: str, **extra: Any) -> list[dict[str, Any]]:
    response = await client.post(f"/api/todos/{id_}/state", json={"state": to, **extra})
    assert response.status_code == 200, response.text
    return response.json()


async def test_an_added_todo_is_open_made_today_with_a_soft_deadline(client: AsyncClient) -> None:
    row = await add(client, "call the bank #money")

    assert row["id"].startswith("kt-")
    assert len(row["id"]) == 9
    assert (row["state"], row["created"], row["tags"], row["version"]) == (
        "open",
        today().isoformat(),
        ["#money"],
        1,
    )
    assert (row["due"], row["due_hard"]) == (
        (today() + timedelta(days=14)).isoformat(),
        False,
    )


async def test_a_part_and_a_shared_item_get_no_default_deadline(client: AsyncClient) -> None:
    parent = await add(client, "pack", due="2026-12-01", due_hard=True)
    part = await add(client, "passport", parent_id=parent["id"])
    milk = await add(client, "Milch", shared_list="Einkauf")

    assert (parent["due_hard"], part["due"], milk["due"]) == (True, None, None)
    assert part["position"] == 0


async def test_a_project_tag_names_its_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "02 Projects/Trip Planning").mkdir(parents=True)
    (vault / "02 Projects/Trip Planning/index.md").write_text("# Trip\n")
    row = await add(client, "book flights #p/trip-planning")
    part = await add(client, "compare", parent_id=row["id"])

    assert (row["project"], part["project"]) == ("02 Projects/Trip Planning",) * 2


async def test_a_change_needs_the_version_it_read(client: AsyncClient) -> None:
    row = await add(client, "draft")
    changed = await client.patch(
        f"/api/todos/{row['id']}", json={"version": 1, "words": "draft the memo #work"}
    )
    stale = await client.patch(f"/api/todos/{row['id']}", json={"version": 1, "words": "x"})

    assert changed.status_code == 200
    assert (changed.json()[0]["tags"], changed.json()[0]["version"]) == (["#work"], 2)
    assert stale.status_code == 409


async def test_a_description_is_kept_apart_from_the_words(client: AsyncClient) -> None:
    row = await add(client, "write the tests", description="start with [[The line reader]]")
    changed = await client.patch(
        f"/api/todos/{row['id']}", json={"version": 1, "description": "#later"}
    )

    cleared = await client.patch(
        f"/api/todos/{row['id']}", json={"version": 2, "description": None}
    )

    assert (row["description"], row["tags"]) == ("start with [[The line reader]]", [])
    assert (changed.json()[0]["description"], changed.json()[0]["tags"]) == ("#later", [])
    assert cleared.json()[0]["description"] is None


async def test_clearing_a_deadline_gives_a_soft_one_again(client: AsyncClient) -> None:
    row = await add(client, "file taxes", due="2027-05-31", due_hard=True)
    changed = await client.patch(f"/api/todos/{row['id']}", json={"version": 1, "due": None})

    assert (changed.json()[0]["due"], changed.json()[0]["due_hard"]) == (
        (today() + timedelta(days=14)).isoformat(),
        False,
    )


async def test_the_walk_and_its_stamps(client: AsyncClient) -> None:
    row = await add(client, "walk")
    seen = []
    for _ in range(3):
        response = await client.post(f"/api/todos/{row['id']}/cycle")
        seen.append((response.json()[0]["state"], response.json()[0]["done"]))

    assert seen == [("doing", None), ("done", today().isoformat()), ("open", None)]


async def test_a_wait_has_a_look_again_day_and_leaving_it_clears_the_wait(
    client: AsyncClient,
) -> None:
    row = await add(client, "visa answer")
    waiting = (await state(client, row["id"], "waiting", waiting_on="[[Consulate]]"))[0]
    again = await state(client, row["id"], "waiting")
    chased = (await state(client, row["id"], "waiting", look_again="2027-01-04"))[0]
    back = (await state(client, row["id"], "open"))[0]

    assert (waiting["waiting_since"], waiting["waiting_on"], waiting["look_again"]) == (
        today().isoformat(),
        "[[Consulate]]",
        (today() + timedelta(days=7)).isoformat(),
    )
    assert again == []
    assert (chased["look_again"], chased["waiting_since"]) == ("2027-01-04", today().isoformat())
    assert (back["waiting_since"], back["waiting_on"], back["look_again"]) == (None, None, None)


async def test_ticking_a_parent_ticks_its_open_parts(client: AsyncClient) -> None:
    parent = await add(client, "move house")
    open_part = await add(client, "boxes", parent_id=parent["id"])
    gone = await add(client, "piano", parent_id=parent["id"])
    await state(client, gone["id"], "rejected")
    await add(client, "tape", parent_id=open_part["id"])
    await state(client, parent["id"], "done")
    found = await rows(client)

    assert {name: found[name]["state"] for name in ("boxes", "tape", "piano")} == {
        "boxes": "done",
        "tape": "done",
        "piano": "rejected",
    }


async def test_closing_a_blocker_opens_what_waits_on_it(client: AsyncClient) -> None:
    blocker = await add(client, "ship it")
    other = await add(client, "review it")
    held = await add(client, "write docs", blocked_by=[blocker["id"], other["id"]])
    await state(client, blocker["id"], "done")
    after_one = (await rows(client))["write docs"]["state"]
    await state(client, other["id"], "rejected")
    after_both = (await rows(client))["write docs"]["state"]
    await state(client, other["id"], "open")

    assert (held["state"], after_one, after_both) == ("blocked", "blocked", "open")
    assert (await rows(client))["write docs"]["state"] == "blocked"


async def test_the_last_blocker_taken_off_opens_the_todo(client: AsyncClient) -> None:
    blocker = await add(client, "ship it")
    held = await add(client, "write docs", blocked_by=[blocker["id"]])
    response = await client.patch(f"/api/todos/{held['id']}", json={"version": 1, "blocked_by": []})

    assert response.json()[0]["state"] == "open"


async def plant(store: AsyncEngine, id_: str, blocked_by: list[str]) -> None:
    """A `blocked_by` written as rows from before #2219 may hold it, past every check."""
    async with store.begin() as connection:
        await connection.exec_driver_sql(
            "UPDATE todos.todo SET blocked_by = %s WHERE id = %s", (blocked_by, id_)
        )


async def test_a_blocker_that_is_no_todo_is_refused_and_one_kept_from_before_stays(
    client: AsyncClient, store: AsyncEngine
) -> None:
    held = await add(client, "write docs")
    await plant(store, held["id"], ["kt-gone"])
    added = {"version": 1, "blocked_by": ["kt-gone", "kt-nothere"]}
    refused = await client.patch(f"/api/todos/{held['id']}", json=added)
    kept = await client.patch(f"/api/todos/{held['id']}", json={"version": 1, "words": "docs"})

    assert refused.status_code == 422
    assert refused.json()["detail"] == "No todo has the id kt-nothere."
    assert kept.json()[0]["blocked_by"] == ["kt-gone"]


async def test_an_id_that_names_no_todo_holds_nothing(
    client: AsyncClient, store: AsyncEngine
) -> None:
    blocker = await add(client, "ship it")
    held = await add(client, "write docs", blocked_by=[blocker["id"]])
    await plant(store, held["id"], [blocker["id"], "kt-gone"])
    await state(client, blocker["id"], "done")

    assert (await rows(client))["write docs"]["state"] == "open"


async def test_deleting_a_blocker_takes_its_id_off_and_opens_what_it_alone_held(
    client: AsyncClient,
) -> None:
    gone = await add(client, "ship it")
    other = await add(client, "book the room")
    alone = await add(client, "write docs", blocked_by=[gone["id"]])
    both = await add(client, "send the mail", blocked_by=[gone["id"], other["id"]])
    doing = await add(client, "print it", blocked_by=[gone["id"]])
    await state(client, doing["id"], "doing")
    await client.delete(f"/api/todos/{gone['id']}")
    found = await rows(client)
    stale = await client.patch(f"/api/todos/{alone['id']}", json={"version": 1, "words": "x"})
    history = (await client.get(f"/api/todos/{alone['id']}/history")).json()

    assert (found["write docs"]["state"], found["write docs"]["blocked_by"]) == ("open", [])
    assert (found["send the mail"]["state"], found["send the mail"]["blocked_by"]) == (
        "blocked",
        [other["id"]],
    )
    assert (found["print it"]["state"], found["print it"]["blocked_by"]) == ("doing", [])
    assert both["state"] == "blocked"
    assert stale.status_code == 409
    assert history[-1]["after"]["state"] == "open"


async def test_deleting_a_parent_frees_what_its_parts_held(client: AsyncClient) -> None:
    parent = await add(client, "move house")
    part = await add(client, "pack books", parent_id=parent["id"])
    held = await add(client, "sell shelf", blocked_by=[part["id"]])
    await client.delete(f"/api/todos/{parent['id']}")
    found = await rows(client)

    assert held["state"] == "blocked"
    assert (found["sell shelf"]["state"], found["sell shelf"]["blocked_by"]) == ("open", [])


@pytest.mark.parametrize("route", ["", "/line"])
async def test_an_added_blocker_that_is_no_todo_is_refused(client: AsyncClient, route: str) -> None:
    body = (
        {"text": "- [ ] write docs ⛔ kt-nothere"}
        if route
        else {"words": "write docs", "blocked_by": ["kt-nothere"]}
    )
    refused = await client.post(f"/api/todos{route}", json=body)

    assert refused.status_code == 422
    assert refused.json()["detail"] == "No todo has the id kt-nothere."
    assert "write docs" not in await rows(client)


async def test_ticking_a_repeat_keeps_its_id_and_moves_it_on(client: AsyncClient) -> None:
    row = await add(client, "water plants", repeat="every week", due="2026-11-16")
    await add(client, "fern", parent_id=row["id"])
    touched = await state(client, row["id"], "done")
    listed = (await client.get("/api/todos/rows")).json()
    found = {(one["words"], one["state"]): one for one in listed}

    live = found[("water plants", "open")]
    finished = found[("water plants", "done")]
    assert (live["id"], live["due"], live["done"]) == (row["id"], "2026-11-23", None)
    assert (finished["round_of"], finished["done"]) == (row["id"], today().isoformat())
    assert found[("fern", "done")]["parent_id"] == finished["id"]
    assert found[("fern", "open")]["parent_id"] == row["id"]
    assert len(touched) == 4


async def test_the_timer_records_sessions_and_totals_them(
    client: AsyncClient, store: AsyncEngine
) -> None:
    row = await add(client, "write")
    started = await client.post(f"/api/todos/{row['id']}/timer")
    async with store.begin() as connection:
        await connection.exec_driver_sql(
            "UPDATE todos.session SET started = started - interval '25 minutes'"
        )
    stopped = await client.post(f"/api/todos/{row['id']}/timer")

    assert started.json()[0]["worked"] is None
    assert stopped.json()[0]["worked"] == 25


async def test_every_write_is_in_the_history_and_a_delete_keeps_it(client: AsyncClient) -> None:
    row = await add(client, "temp")
    await state(client, row["id"], "doing")
    deleted = await client.delete(f"/api/todos/{row['id']}")
    history = (await client.get(f"/api/todos/{row['id']}/history")).json()

    assert deleted.status_code == 204
    assert [(one["before"] is None, one["after"] is None) for one in history] == [
        (True, False),
        (False, False),
        (False, True),
    ]
    assert history[1]["after"]["state"] == "doing"


async def test_a_delete_sent_with_a_stale_version_is_refused(client: AsyncClient) -> None:
    row = await add(client, "share the story")
    doing = (await state(client, row["id"], "doing"))[0]
    stale = await client.delete(f"/api/todos/{row['id']}", params={"version": row["version"]})
    kept = "share the story" in await rows(client)
    fresh = await client.delete(f"/api/todos/{row['id']}", params={"version": doing["version"]})

    assert (stale.status_code, kept, fresh.status_code) == (409, True, 204)


async def test_an_unknown_id_is_404_and_the_archive_waits_to_be_asked(client: AsyncClient) -> None:
    missing = await client.post("/api/todos/kt-nothere/cycle")
    await add(client, "old", note="98 Archive/old.md")

    assert missing.status_code == 404
    assert ("old" in await rows(client), "old" in await rows(client, archive=True)) == (False, True)


async def test_a_repeat_counts_off_its_planned_day_before_a_soft_due(client: AsyncClient) -> None:
    monday = "2026-11-16"
    row = await add(client, "standup notes", repeat="every week on Monday", planned=monday)
    await state(client, row["id"], "done")
    listed = (await client.get("/api/todos/rows")).json()
    live = next(one for one in listed if one["id"] == row["id"])

    assert (live["state"], live["planned"]) == ("open", "2026-11-23")


async def test_a_rounds_time_stays_with_the_round(client: AsyncClient, store: AsyncEngine) -> None:
    row = await add(client, "practice", repeat="every day", due="2026-11-18", due_hard=True)
    await client.post(f"/api/todos/{row['id']}/timer")
    async with store.begin() as connection:
        await connection.exec_driver_sql(
            "UPDATE todos.session SET started = started - interval '30 minutes'"
        )
    await client.post(f"/api/todos/{row['id']}/timer")
    await state(client, row["id"], "done")
    await client.post(f"/api/todos/{row['id']}/timer")
    async with store.begin() as connection:
        await connection.exec_driver_sql(
            "UPDATE todos.session SET started = started - interval '10 minutes' WHERE ended IS NULL"
        )
    stopped = await client.post(f"/api/todos/{row['id']}/timer")

    assert stopped.json()[0]["worked"] == 10


async def test_a_parent_must_be_a_todo_and_not_the_todo_or_its_part(client: AsyncClient) -> None:
    top = await add(client, "top")
    part = await add(client, "part", parent_id=top["id"])
    nowhere = await client.post("/api/todos", json={"words": "x", "parent_id": "kt-nothere"})
    itself = await client.patch(
        f"/api/todos/{top['id']}", json={"version": 1, "parent_id": top["id"]}
    )
    loop = await client.patch(
        f"/api/todos/{top['id']}", json={"version": 1, "parent_id": part["id"]}
    )

    assert [nowhere.status_code, itself.status_code, loop.status_code] == [422, 422, 422]


async def test_deleting_a_parent_records_each_part_it_takes(client: AsyncClient) -> None:
    top = await add(client, "top")
    part = await add(client, "part", parent_id=top["id"])
    await client.delete(f"/api/todos/{top['id']}")
    history = (await client.get(f"/api/todos/{part['id']}/history")).json()

    assert [one["after"] is None for one in history] == [False, True]


async def test_a_timer_running_at_the_tick_stays_on_the_todo(client: AsyncClient) -> None:
    row = await add(client, "practice", repeat="every day", due="2026-11-18")
    await client.post(f"/api/todos/{row['id']}/timer")
    await state(client, row["id"], "done")
    stopped = await client.post(f"/api/todos/{row['id']}/timer")

    assert stopped.json()[0]["worked"] == 0


async def test_a_repeat_moves_each_of_its_dates_on(client: AsyncClient) -> None:
    row = await add(
        client,
        "file the invoice",
        repeat="every month",
        due="2026-11-30",
        due_hard=True,
        planned="2026-11-25",
        hold_until="2026-11-20",
    )
    await state(client, row["id"], "done")
    live = next(
        one for one in (await client.get("/api/todos/rows")).json() if one["id"] == row["id"]
    )

    assert (live["due"], live["planned"], live["hold_until"]) == (
        "2026-12-30",
        "2026-12-25",
        "2026-12-20",
    )


async def test_a_todo_counts_toward_an_epic_only_while_it_is_one(client: AsyncClient) -> None:
    epic = await add(client, "launch", epic=True)
    plain_todo = await add(client, "not an epic")
    member = await add(client, "write the post", epic_id=epic["id"])
    refused = await client.post("/api/todos", json={"words": "x", "epic_id": plain_todo["id"]})
    unmarked = await client.patch(f"/api/todos/{epic['id']}", json={"version": 1, "epic": False})

    assert (member["epic_id"], refused.status_code) == (epic["id"], 422)
    assert {one["words"]: one["epic_id"] for one in unmarked.json()} == {
        "launch": None,
        "write the post": None,
    }
