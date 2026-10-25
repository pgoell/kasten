"""Assigning a shared list's item: other bytes stay, a stale sha is 409, a stranger is 422."""

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend import share
from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from collections.abc import Iterator

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

PEOPLE = '{"pascal@example.test": "Pascal", "alicia@example.test": "Alicia"}'


def body_of(text: str) -> str:
    """The note after its frontmatter, which a save restamps and so is not compared whole."""
    return text.split("---", 2)[2]


def put(folder: Path, text: str) -> str:
    """Write the list `Einkauf` exactly as given, and return the digest its bytes make."""
    (folder / "Einkauf.md").write_bytes(text.encode("utf-8"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@pytest.fixture
def folder(agent_vault: Path) -> Path:
    """The share folder, empty, in the agent's vault."""
    path = agent_vault / "05 Shared"
    path.mkdir()
    return path


@pytest.fixture
def people(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Pascal and Alicia as the two people the app knows, read from the environment."""
    monkeypatch.setenv("KASTEN_SHARE_PEOPLE", PEOPLE)
    get_settings.cache_clear()

    yield

    get_settings.cache_clear()


@pytest.mark.usefixtures("people")
async def test_810_i1_assign_keeps_every_other_byte_and_the_crlf(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(
        folder,
        BLOCK + "- [ ] Milch 👤 [[Pascal]] #bio\r\n- [x] Brot ✅ 2026-10-19 🆔 kt-000001 ^abc\r\n",
    )

    response = await client.post(
        "/share/lists/Einkauf/assign", json={"line": 6, "assignee": "Alicia", "sha": sha}
    )

    written = (folder / "Einkauf.md").read_bytes().decode("utf-8")
    # The save writes the frontmatter's line ending as the body's, so the body opens with a CRLF.
    assert body_of(written) == (
        "\r\n- [ ] Milch 👤 [[Alicia]] #bio\r\n- [x] Brot ✅ 2026-10-19 🆔 kt-000001 ^abc\r\n"
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["assignee"] == "[[Alicia]]"


@pytest.mark.usefixtures("people")
async def test_810_i1_a_clear_takes_the_blank_before_the_field_only(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, BLOCK + "- [ ] buy paint 👤 [[Pascal]] 📅 2026-10-30 #home\n")

    response = await client.post(
        "/share/lists/Einkauf/assign", json={"line": 6, "assignee": None, "sha": sha}
    )

    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n- [ ] buy paint 📅 2026-10-30 #home\n"
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["assignee"] is None


@pytest.mark.usefixtures("people")
async def test_810_i2_a_stale_sha_answers_409_and_writes_nothing(
    client: AsyncClient, folder: Path
) -> None:
    text = BLOCK + "- [ ] Milch\n"
    put(folder, text)

    response = await client.post(
        "/share/lists/Einkauf/assign", json={"line": 6, "assignee": "Alicia", "sha": "0" * 64}
    )

    assert (folder / "Einkauf.md").read_bytes() == text.encode("utf-8")
    assert response.json().get("current") == hashlib.sha256(text.encode("utf-8")).hexdigest()
    assert response.status_code == 409


@pytest.mark.usefixtures("people")
async def test_810_i2_an_assign_already_in_the_asked_state_writes_nothing(
    client: AsyncClient, folder: Path
) -> None:
    text = BLOCK + "- [ ] Milch 👤 [[Alicia]]\n"
    sha = put(folder, text)

    response = await client.post(
        "/share/lists/Einkauf/assign", json={"line": 6, "assignee": "Alicia", "sha": sha}
    )

    assert (folder / "Einkauf.md").read_bytes() == text.encode("utf-8")
    assert response.json().get("sha") == sha
    assert response.status_code == 200


@pytest.mark.usefixtures("people")
async def test_810_i2_a_line_that_is_no_task_writes_nothing(
    client: AsyncClient, folder: Path
) -> None:
    text = BLOCK + "- [ ] Milch\n"
    sha = put(folder, text)

    response = await client.post(
        "/share/lists/Einkauf/assign", json={"line": 0, "assignee": "Alicia", "sha": sha}
    )

    assert (folder / "Einkauf.md").read_bytes() == text.encode("utf-8")
    assert response.json().get("sha") == sha
    assert response.status_code == 200


@pytest.mark.usefixtures("people")
async def test_810_i3_a_name_outside_the_people_answers_422_and_writes_nothing(
    client: AsyncClient, folder: Path
) -> None:
    text = BLOCK + "- [ ] Milch\n"
    sha = put(folder, text)

    response = await client.post(
        "/share/lists/Einkauf/assign", json={"line": 6, "assignee": "Bob", "sha": sha}
    )

    assert (folder / "Einkauf.md").read_bytes() == text.encode("utf-8")
    assert response.json().get("detail") == "Not one of the people"
    assert response.status_code == 422


@pytest.mark.usefixtures("people")
async def test_810_a5_assign_then_read_names_the_assignee(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, BLOCK + "- [ ] Milch\n")

    assigned = await client.post(
        "/share/lists/Einkauf/assign", json={"line": 6, "assignee": "Pascal", "sha": sha}
    )
    read = await client.get("/share/lists/Einkauf")

    assert (
        (folder / "Einkauf.md").read_bytes().decode("utf-8").endswith("- [ ] Milch 👤 [[Pascal]]\n")
    )
    assert assigned.status_code == 200
    assert read.json()["items"] == [
        {
            "line": 6,
            "text": "Milch",
            "done": False,
            "assignee": "[[Pascal]]",
            "ticked_by": None,
            "ticked_at": None,
        }
    ]


@pytest.mark.usefixtures("people")
async def test_810_r7_4_a_glued_due_date_survives_a_switch_and_a_clear(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, BLOCK + "- [ ] Milch 👤 [[Alicia]]📅 2026-10-30 ^abc\n")

    switched = await client.post(
        "/share/lists/Einkauf/assign", json={"line": 6, "assignee": "Pascal", "sha": sha}
    )

    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n- [ ] Milch 👤 [[Pascal]]📅 2026-10-30 ^abc\n"
    )
    assert switched.status_code == 200

    cleared = await client.post(
        "/share/lists/Einkauf/assign",
        json={"line": 6, "assignee": None, "sha": switched.json()["sha"]},
    )

    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n- [ ] Milch 📅 2026-10-30 ^abc\n"
    )
    assert cleared.status_code == 200


@pytest.mark.usefixtures("people")
async def test_810_a10_assign_writes_every_row_of_the_case_table(
    client: AsyncClient, folder: Path
) -> None:
    lines: dict[tuple[str, str], str] = {}
    reads: dict[tuple[str, str], tuple[str, str | None]] = {}
    for case in (case for case in CASES if "from" in case):
        for box in (" ", "x"):
            sha = put(folder, BLOCK + f"- [{box}] {case['from']}\n")
            await client.post(
                "/share/lists/Einkauf/assign",
                json={"line": 6, "assignee": case["assign"], "sha": sha},
            )
            written = (folder / "Einkauf.md").read_text(encoding="utf-8")
            lines[case["id"], box] = body_of(written).split("\n")[1]
            # The list reads words without a block id, so the table's text loses one too.
            item = share.items(written)[0]
            reads[case["id"], box] = (item.text, item.assignee)

    assert lines == {
        (case["id"], box): f"- [{box}] {case['rest']}"
        for case in CASES
        if "from" in case
        for box in (" ", "x")
    }
    assert reads == {
        (case["id"], box): (share.BLOCK_ID.sub("", case["text"]), case["assignee"])
        for case in CASES
        if "from" in case
        for box in (" ", "x")
    }
