"""The assignee `👤 [[name]]` of a todo and of a shared list's item, against the one case table.

The table is the file the editor's tests read too, so the two sides cannot
drift apart on which `👤` is the assignee. The writes of a shared list keep the
field's bytes, and the answer names it.
"""

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend import share, todos

if TYPE_CHECKING:
    from httpx import AsyncClient

CASES = json.loads(
    (Path(__file__).parents[2] / "frontend/src/lib/person-field-cases.json").read_text(
        encoding="utf-8"
    )
)

BLOCK = (
    "---\n"
    "id: 0190b7a0-0000-7000-8000-000000000001\n"
    "created: 2026-10-01T10:00:00+00:00\n"
    "type: Note\n"
    "modified: 2026-10-01T10:00:00+00:00\n"
    "---\n"
)
"""A frontmatter block the save leaves alone but for its `modified` line."""


def body_of(text: str) -> str:
    """The note after its frontmatter, which a save restamps and so is not compared whole."""
    return text.split("---", 2)[2]


@pytest.fixture
def folder(agent_vault: Path) -> Path:
    """The share folder, empty, in the agent's vault."""
    path = agent_vault / "05 Shared"
    path.mkdir()
    return path


def put(folder: Path, text: str) -> str:
    """Write the list `Einkauf` exactly as given, and return the digest its bytes make."""
    (folder / "Einkauf.md").write_bytes(text.encode("utf-8"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def test_809_a1_the_words_of_every_case_of_the_person_field_table() -> None:
    assert {case["id"]: todos._words(case["rest"]).strip() for case in CASES} == {
        case["id"]: case["text"] for case in CASES
    }


def test_809_a1_the_shared_list_reads_the_assignee_of_every_case() -> None:
    assert {
        case["id"]: share.items("- [ ] " + case["rest"])[0].model_dump().get("assignee")
        for case in CASES
    } == {case["id"]: case["assignee"] for case in CASES}


async def test_809_a6_tick_and_untick_keep_the_assignee_bytes(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, BLOCK + "- [ ] milk 👤 [[Pascal]]\n")

    ticked = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )
    unticked = await client.post(
        "/share/lists/Einkauf/tick",
        json={"line": 6, "done": False, "sha": ticked.json()["sha"]},
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    assert ticked.status_code == 200
    assert unticked.status_code == 200
    assert [
        ticked.json()["items"][0].get("assignee"),
        unticked.json()["items"][0].get("assignee"),
    ] == [
        "[[Pascal]]",
        "[[Pascal]]",
    ]
    assert body_of(written).startswith("\n- [ ] milk 👤 [[Pascal]] 🆔 kt-")
    assert body_of(written).endswith("\n")


async def test_809_a6_add_keeps_a_typed_assignee(client: AsyncClient, folder: Path) -> None:
    sha = put(folder, BLOCK + "- [ ] milk 👤 [[Pascal]]\n")

    response = await client.post(
        "/share/lists/Einkauf/items", json={"text": "eggs 👤 [[Pascal]]", "sha": sha}
    )

    assert response.status_code == 200
    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n- [ ] milk 👤 [[Pascal]]\n- [ ] eggs 👤 [[Pascal]]\n"
    )
    assert [item.get("assignee") for item in response.json()["items"]] == [
        "[[Pascal]]",
        "[[Pascal]]",
    ]


async def test_809_a6_clear_removes_only_ticked_lines_with_their_assignee(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(
        folder,
        BLOCK
        + "- [ ] milk 👤 [[Pascal]]\n"
        + "- [x] eggs 👤 [[Pascal]] ✅ 2026-10-19 🆔 kt-000001\n"
        + "- [ ] bread 👤 Alicia\n",
    )

    response = await client.post("/share/lists/Einkauf/clear", json={"sha": sha})

    assert response.status_code == 200
    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n- [ ] milk 👤 [[Pascal]]\n- [ ] bread 👤 Alicia\n"
    )
    assert [item.get("assignee") for item in response.json()["items"]] == [
        "[[Pascal]]",
        "Alicia",
    ]


async def test_809_a6_the_route_answers_the_assignee(client: AsyncClient, folder: Path) -> None:
    put(folder, BLOCK + "- [ ] milk 👤 [[Pascal]]\n- [ ] eggs\n")

    response = await client.get("/share/lists/Einkauf")

    assert response.json()["items"] == [
        {
            "line": 6,
            "text": "milk",
            "done": False,
            "assignee": "[[Pascal]]",
            "ticked_by": None,
            "ticked_at": None,
        },
        {
            "line": 7,
            "text": "eggs",
            "done": False,
            "assignee": None,
            "ticked_by": None,
            "ticked_at": None,
        },
    ]
