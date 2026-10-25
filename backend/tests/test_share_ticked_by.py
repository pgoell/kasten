"""Who ticked each done item of a shared list, read back from the note's jj history (#725)."""

import re
from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest import JJ, jj
from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from httpx import AsyncClient

pytestmark = pytest.mark.skipif(JJ is None, reason="jj is not installed")

PEOPLE = '{"pascal@example.test": "Pascal", "alicia@example.test": "Alicia"}'

PASCAL = {"X-Auth-Request-Email": "pascal@example.test"}
ALICIA = {"X-Auth-Request-Email": "alicia@example.test"}
NOBODY: dict[str, str] = {}

ISO_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}")
"""An ISO 8601 time with its offset, as the history's committer time is written."""


@pytest.fixture
def people(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Pascal and Alicia as the two people the app knows, read from the environment."""
    monkeypatch.setenv("KASTEN_SHARE_PEOPLE", PEOPLE)
    get_settings.cache_clear()

    yield

    get_settings.cache_clear()


@pytest.fixture
def folder(versioned_agent_vault: Path) -> Path:
    """The share folder, empty, in a versioned agent vault."""
    path = versioned_agent_vault / "05 Shared"
    path.mkdir()
    return path


async def _add(
    client: AsyncClient, text: str, headers: dict[str, str], sha: str | None = None
) -> dict:
    """Append one item, creating the list when it is not there, and answer the list."""
    response = await client.post(
        "/share/lists/Einkauf/items", json={"text": text, "sha": sha}, headers=headers
    )
    assert response.status_code == 200
    return response.json()


async def _tick(client: AsyncClient, sha: str, done: bool, headers: dict[str, str]) -> dict:
    """Tick or untick the first item of the list and answer the list."""
    response = await client.post(
        "/share/lists/Einkauf/tick",
        json={"line": 6, "done": done, "sha": sha},
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()


def _first(answer: dict) -> dict:
    """The first item of a list answer."""
    return answer["items"][0]


@pytest.mark.usefixtures("people")
async def test_810_a7_the_read_names_who_ticked_and_when(client: AsyncClient, folder: Path) -> None:
    added = await _add(client, "Milch", PASCAL)

    ticked = await _tick(client, added["sha"], True, ALICIA)
    read = await client.get("/share/lists/Einkauf", headers=PASCAL)

    assert _first(ticked).get("ticked_by") == "Alicia"
    assert ISO_TIME.fullmatch(_first(ticked).get("ticked_at") or "")
    assert _first(read.json()).get("ticked_by") == "Alicia"
    assert _first(read.json()).get("ticked_at") == _first(ticked).get("ticked_at")


@pytest.mark.usefixtures("people")
async def test_810_a7_a_list_with_an_umlaut_in_its_name_names_the_ticker(
    client: AsyncClient, folder: Path
) -> None:
    added = await client.post(
        "/share/lists/Bücher/items", json={"text": "Milch", "sha": None}, headers=PASCAL
    )
    ticked = await client.post(
        "/share/lists/Bücher/tick",
        json={"line": 6, "done": True, "sha": added.json()["sha"]},
        headers=ALICIA,
    )

    assert _first(ticked.json()).get("ticked_by") == "Alicia"


@pytest.mark.usefixtures("people")
async def test_810_i5_a_re_tick_after_an_untick_names_the_second_ticker(
    client: AsyncClient, folder: Path
) -> None:
    added = await _add(client, "Milch", PASCAL)
    first = await _tick(client, added["sha"], True, ALICIA)
    unticked = await _tick(client, first["sha"], False, PASCAL)

    # Pascal adds an item before ticking again: the untick and the re-tick alone
    # can leave the note as the tick found it, and a change that changes nothing
    # is no change the history lists.
    added_more = await _add(client, "Brot", PASCAL, unticked["sha"])
    again = await _tick(client, added_more["sha"], True, PASCAL)
    read = await client.get("/share/lists/Einkauf", headers=ALICIA)

    assert _first(again).get("ticked_by") == "Pascal"
    assert _first(read.json()).get("ticked_by") == "Pascal"


@pytest.mark.usefixtures("people")
async def test_810_i5_an_assign_on_a_done_line_keeps_the_ticker(
    client: AsyncClient, folder: Path
) -> None:
    added = await _add(client, "Milch", PASCAL)
    ticked = await _tick(client, added["sha"], True, ALICIA)

    assigned = await client.post(
        "/share/lists/Einkauf/assign",
        json={"line": 6, "assignee": "Pascal", "sha": ticked["sha"]},
        headers=PASCAL,
    )
    read = await client.get("/share/lists/Einkauf", headers=PASCAL)

    assert _first(read.json()).get("assignee") == "[[Pascal]]"
    assert _first(read.json()).get("ticked_by") == "Alicia"
    assert assigned.status_code == 200


@pytest.mark.usefixtures("people")
async def test_810_a9_a_tick_with_no_header_has_no_name_and_a_time(
    client: AsyncClient, folder: Path
) -> None:
    added = await _add(client, "Milch", NOBODY)

    ticked = await _tick(client, added["sha"], True, NOBODY)

    assert _first(ticked).get("ticked_by") is None
    assert ISO_TIME.fullmatch(_first(ticked).get("ticked_at") or "")


@pytest.fixture
def plain_folder(agent_vault: Path) -> Path:
    """The share folder, empty, in an agent vault that is no jj repo."""
    path = agent_vault / "05 Shared"
    path.mkdir()
    return path


@pytest.mark.usefixtures("people")
async def test_810_i4_a_vault_with_no_history_answers_nulls(
    client: AsyncClient, plain_folder: Path
) -> None:
    added = await _add(client, "Milch", NOBODY)
    ticked = await _tick(client, added["sha"], True, NOBODY)

    assert ticked["items"] == [
        {
            "line": 6,
            "text": "Milch",
            "done": True,
            "assignee": None,
            "ticked_by": None,
            "ticked_at": None,
        }
    ]


@pytest.mark.usefixtures("people")
async def test_810_i4_jj_missing_from_the_path_answers_nulls(
    client: AsyncClient, folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    added = await _add(client, "Milch", PASCAL)
    ticked = await _tick(client, added["sha"], True, ALICIA)

    monkeypatch.setenv("PATH", "")
    read = await client.get("/share/lists/Einkauf", headers=PASCAL)

    assert read.status_code == 200
    assert _first(read.json()) == {
        "line": 6,
        "text": "Milch",
        "done": True,
        "assignee": None,
        "ticked_by": None,
        "ticked_at": None,
    }
    assert _first(ticked).get("ticked_by") == "Alicia"


@pytest.mark.usefixtures("people")
async def test_810_i4_the_read_writes_no_operation(
    client: AsyncClient, folder: Path, versioned_agent_vault: Path
) -> None:
    added = await _add(client, "Milch", PASCAL)
    await _tick(client, added["sha"], True, ALICIA)
    before = jj(
        versioned_agent_vault,
        "--ignore-working-copy",
        "op",
        "log",
        "--no-graph",
        "-T",
        'id.short() ++ "\\n"',
    )

    read = await client.get("/share/lists/Einkauf", headers=PASCAL)

    after = jj(
        versioned_agent_vault,
        "--ignore-working-copy",
        "op",
        "log",
        "--no-graph",
        "-T",
        'id.short() ++ "\\n"',
    )
    assert read.status_code == 200
    assert after == before
