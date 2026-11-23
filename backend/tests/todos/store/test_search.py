"""The store's search (#2191): every filter, the hidden todos and the priority order."""

from typing import TYPE_CHECKING, Any

import pytest

if TYPE_CHECKING:
    from httpx import AsyncClient

pytestmark = pytest.mark.usefixtures("vault", "store")


async def add(client: AsyncClient, words: str, **fields: Any) -> dict[str, Any]:
    response = await client.post("/api/todos", json={"words": words, **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def found(client: AsyncClient, **params: Any) -> list[str]:
    response = await client.get("/api/todos/rows", params=params)
    assert response.status_code == 200, response.text
    return [row["words"] for row in response.json()]


async def test_words_state_and_tags(client: AsyncClient) -> None:
    await add(client, "call the bank #money")
    trip = await add(client, "book flights #p/trip/flights")
    await client.post(f"/api/todos/{trip['id']}/state", json={"state": "waiting"})

    assert await found(client, words="BANK") == ["call the bank #money"]
    assert await found(client, state="waiting") == ["book flights #p/trip/flights"]
    assert await found(client, tag="p/trip") == ["book flights #p/trip/flights"]
    assert await found(client, tag="#money", state=["open", "doing"]) == ["call the bank #money"]


async def test_kind_epic_and_parent_take_the_parts_along(client: AsyncClient) -> None:
    launch = await add(client, "launch", epic=True)
    pitch = await add(client, "pitch #client", epic_id=launch["id"])
    deck = await add(client, "deck", parent_id=pitch["id"])
    await add(client, "slides", parent_id=deck["id"])
    await add(client, "other")

    assert sorted(await found(client, kind="client")) == ["deck", "pitch #client", "slides"]
    assert sorted(await found(client, epic=launch["id"])) == ["deck", "pitch #client", "slides"]
    assert sorted(await found(client, parent=pitch["id"])) == ["deck", "slides"]


async def test_dates_and_what_no_list_shows_yet(client: AsyncClient) -> None:
    await add(client, "held", hold_until="2026-12-01")
    await add(client, "due soon", due="2026-11-20", due_hard=True)
    await add(client, "planned", planned="2026-11-19")
    wait = await add(client, "wait")
    await client.post(
        f"/api/todos/{wait['id']}/state", json={"state": "waiting", "look_again": "2026-11-25"}
    )

    shown = await found(client, shown_on="2026-11-19")
    assert ("held" in shown, "wait" in shown, "due soon" in shown) == (False, False, True)
    assert "wait" in await found(client, shown_on="2026-11-25")
    assert await found(client, due_by="2026-11-21") == ["due soon"]
    assert await found(client, planned_on="2026-11-19") == ["planned"]
    assert await found(client, look_again_by="2026-11-30") == ["wait"]
    assert await found(client, waiting=True) == ["wait"]


async def test_priority_filter_and_order_put_none_between_medium_and_low(
    client: AsyncClient,
) -> None:
    for words, level in (("c", "low"), ("a", "highest"), ("b", None), ("d", "medium")):
        await add(client, words, **({"priority": level} if level else {}))

    assert await found(client, sort="priority") == ["a", "d", "b", "c"]
    assert sorted(await found(client, priority=["none", "low"])) == ["b", "c"]
    assert await found(client, sort="priority", limit=2) == ["a", "d"]


async def test_done_from_and_to_keep_the_todos_done_in_the_range(client: AsyncClient) -> None:
    done = await add(client, "filed")
    await add(client, "still open")
    ticked = await client.post(f"/api/todos/{done['id']}/state", json={"state": "done"})
    day = ticked.json()[0]["done"]

    assert await found(client, done_from=day, done_to=day) == ["filed"]
    assert await found(client, done_to="2000-01-01") == []
