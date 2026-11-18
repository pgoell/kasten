"""The todo tools an agent reaches through MCP (#2191): find, add, change, wait and complete."""

import asyncio
from datetime import date
from typing import Any

import pytest
from mcp.server.mcpserver.exceptions import ToolError

from kasten_backend import events
from kasten_backend.todos.serve import tools

pytestmark = pytest.mark.usefixtures("agent_vault", "store")


async def test_an_agent_adds_finds_changes_and_completes_a_todo() -> None:
    added = (await tools.add_todo("call the bank #money", due=date(2026, 12, 1), due_hard=True))[0]
    found = await tools.search_todos(words="bank")
    by_state = await tools.search_todos(state=["open"])
    changed = (await tools.change_todo(added["id"], added["version"], priority="high"))[0]
    cleared = (await tools.change_todo(added["id"], changed["version"], clear=["priority"]))[0]
    done = (await tools.complete_todo(added["id"]))[0]

    assert [row["id"] for row in found] == [added["id"]] == [row["id"] for row in by_state]
    assert (added["due"], added["due_hard"], added["note"].endswith(".md")) == (
        "2026-12-01",
        True,
        True,
    )
    assert (changed["priority"], cleared["priority"], done["state"]) == ("high", None, "done")


async def test_a_wait_and_a_stale_change_through_the_tools() -> None:
    added = (await tools.add_todo("visa answer"))[0]
    waiting = (
        await tools.set_todo_state(
            added["id"], "waiting", look_again=date(2026, 12, 4), waiting_on="[[Consulate]]"
        )
    )[0]

    assert (waiting["state"], waiting["look_again"]) == ("waiting", "2026-12-04")
    assert await tools.search_todos(waiting=True, shown_on=date(2026, 12, 3)) == []
    with pytest.raises(ToolError, match="Refused"):
        await tools.change_todo(added["id"], added["version"], words="x")
    with pytest.raises(ToolError, match="No todo"):
        await tools.complete_todo("kt-nothere")


async def test_a_store_write_tells_the_open_streams_once_it_commits() -> None:
    queue: asyncio.Queue[Any] = asyncio.Queue()
    events.TODO_LISTENERS.add(queue)
    try:
        await tools.add_todo("call the bank")
    finally:
        events.TODO_LISTENERS.discard(queue)

    told = queue.get_nowait()
    assert [(one.change, one.path) for one in told] == [("todos", "")]
