"""What the list routes read and write: the items, the marks, and the digests that guard them."""

import hashlib
import re
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from datetime import date
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
"""A frontmatter block the save leaves alone but for its `modified` line."""


def digest(text: str) -> str:
    """The digest the routes report, taken over the bytes as they sit on disk."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def body_of(text: str) -> str:
    """The note after its frontmatter, which a save restamps and so is not compared whole."""
    return text.split("---", 2)[2]


@pytest.fixture
def folder(agent_vault: Path) -> Path:
    """The share folder, empty, in the agent's vault."""
    path = agent_vault / "05 Shared"
    path.mkdir()
    return path


def put(folder: Path, text: str, name: str = "Einkauf") -> str:
    """Write a list's bytes exactly as given, and return the digest they make."""
    (folder / f"{name}.md").write_bytes(text.encode("utf-8"))
    return digest(text)


async def test_read_returns_the_items_without_markdown_or_fields(
    client: AsyncClient, folder: Path
) -> None:
    text = (
        BLOCK
        + "# Einkauf\n\nFür Samstag.\n\n"
        + "- [ ] Milch 📅 2026-10-21\n"
        + "- [x] Brot ✅ 2026-10-19 🆔 kt-000001\n"
        + "- [X] Eier\n"
        + "  - [ ] nested Käse\n"
        + "- [ ] Butter ⏫ #einkauf\n"
    )
    sha = put(folder, text)

    response = await client.get("/share/lists/Einkauf")

    assert response.status_code == 200
    assert response.json() == {
        "name": "Einkauf",
        "sha": sha,
        "items": [
            {
                "line": 10,
                "text": "Milch",
                "done": False,
                "assignee": None,
                "ticked_by": None,
                "ticked_at": None,
            },
            {
                "line": 11,
                "text": "Brot",
                "done": True,
                "assignee": None,
                "ticked_by": None,
                "ticked_at": None,
            },
            {
                "line": 12,
                "text": "Eier",
                "done": True,
                "assignee": None,
                "ticked_by": None,
                "ticked_at": None,
            },
            {
                "line": 14,
                "text": "Butter",
                "done": False,
                "assignee": None,
                "ticked_by": None,
                "ticked_at": None,
            },
        ],
    }


async def test_read_of_a_list_not_yet_written_is_empty_with_no_sha(
    client: AsyncClient, folder: Path
) -> None:
    response = await client.get("/share/lists/Todo")

    assert response.status_code == 200
    assert response.json() == {"name": "Todo", "sha": None, "items": []}


async def test_add_appends_after_the_last_item_and_keeps_every_other_byte(
    client: AsyncClient, folder: Path
) -> None:
    text = (
        BLOCK
        + "# Einkauf\n\n- [ ] Milch\n- [x] Brot ✅ 2026-10-19 🆔 kt-000001\n"
        + "\nNotiz: nach dem Einkauf.\n"
    )
    sha = put(folder, text)

    response = await client.post("/share/lists/Einkauf/items", json={"text": "Eier", "sha": sha})

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    assert response.status_code == 200
    assert "id: 0190b7a0-0000-7000-8000-000000000001" in written
    assert body_of(written) == (
        "\n# Einkauf\n\n- [ ] Milch\n- [x] Brot ✅ 2026-10-19 🆔 kt-000001\n"
        "- [ ] Eier\n\nNotiz: nach dem Einkauf.\n"
    )


async def test_add_keeps_crlf_line_endings(client: AsyncClient, folder: Path) -> None:
    text = (BLOCK + "# Einkauf\n\n- [ ] Milch\n\nFertig.\n").replace("\n", "\r\n")
    sha = put(folder, text)

    response = await client.post("/share/lists/Einkauf/items", json={"text": "Brot", "sha": sha})

    written = (folder / "Einkauf.md").read_bytes().decode("utf-8")
    assert response.status_code == 200
    assert body_of(written) == "\r\n# Einkauf\r\n\r\n- [ ] Milch\r\n- [ ] Brot\r\n\r\nFertig.\r\n"


async def test_add_creates_a_list_that_is_not_there(client: AsyncClient, folder: Path) -> None:
    response = await client.post("/share/lists/Todo/items", json={"text": "Milch", "sha": None})

    assert response.status_code == 200
    assert [item["text"] for item in response.json()["items"]] == ["Milch"]
    assert (folder / "Todo.md").is_file()


async def test_blank_text_answers_422(client: AsyncClient, folder: Path) -> None:
    sha = put(folder, BLOCK + "- [ ] Milch\n")

    response = await client.post("/share/lists/Einkauf/items", json={"text": "   ", "sha": sha})

    assert response.status_code == 422


async def test_tick_done_writes_the_done_mark_and_an_id(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, BLOCK + "- [ ] Milch\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert re.search(rf"^- \[x\] Milch ✅ {today} 🆔 kt-[0-9a-f]{{6}}$", written, re.MULTILINE)


async def test_1051_tick_stamps_an_id_when_the_words_hold_a_bare_id_sign(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, BLOCK + "- [ ] a 🆔 ⛔ kt-1 more\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert re.search(
        rf"^- \[x\] a 🆔 ⛔ kt-1 more ✅ {today} 🆔 kt-[0-9a-f]{{6}}$", written, re.MULTILINE
    )


async def test_1051_tick_keeps_the_id_the_line_reads_after_a_bare_id_sign(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, BLOCK + "- [ ] a 🆔 ⛔ kt-1 🆔\N{VARIATION SELECTOR-16} kt-000002\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert body_of(written) == (
        f"\n- [x] a 🆔 ⛔ kt-1 ✅ {today} 🆔\N{VARIATION SELECTOR-16} kt-000002\n"
    )


async def test_1051_tick_stamps_an_id_after_a_trailing_bare_id_sign(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, BLOCK + "- [ ] a 🆔\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert re.search(rf"^- \[x\] a 🆔 ✅ {today} 🆔 kt-[0-9a-f]{{6}}$", written, re.MULTILINE)


async def test_1051_tick_stamps_an_id_when_the_id_sits_in_a_link_or_code_span(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, BLOCK + "- [ ] see [[🆔 kt-1]] and `🆔 kt-2`\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert re.search(
        rf"^- \[x\] see \[\[🆔 kt-1\]\] and `🆔 kt-2` ✅ {today} 🆔 kt-[0-9a-f]{{6}}$",
        written,
        re.MULTILINE,
    )


async def test_untick_strips_the_done_mark_and_keeps_the_id(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, BLOCK + "- [x] Brot ✅ 2026-10-19 🆔 kt-000001\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": False, "sha": sha}
    )

    assert response.status_code == 200
    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n- [ ] Brot 🆔 kt-000001\n"
    )


async def test_tick_already_in_the_asked_state_answers_200_and_writes_nothing(
    client: AsyncClient, folder: Path
) -> None:
    text = BLOCK + "- [ ] Milch\n"
    sha = put(folder, text)

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": False, "sha": sha}
    )

    assert response.status_code == 200
    assert response.json()["sha"] == sha
    assert (folder / "Einkauf.md").read_bytes() == text.encode("utf-8")


async def test_clear_removes_only_the_done_items(client: AsyncClient, folder: Path) -> None:
    sha = put(
        folder,
        BLOCK
        + "# Einkauf\n\n- [x] Brot ✅ 2026-10-19 🆔 kt-000001\n- [ ] Milch\n- [X] Eier\n\nNotiz.\n",
    )

    response = await client.post("/share/lists/Einkauf/clear", json={"sha": sha})

    assert response.status_code == 200
    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n# Einkauf\n\n- [ ] Milch\n\nNotiz.\n"
    )


async def test_a_stale_sha_answers_409_with_the_current_one(
    client: AsyncClient, folder: Path
) -> None:
    current = put(folder, BLOCK + "- [ ] Milch\n")

    response = await client.post(
        "/share/lists/Einkauf/items", json={"text": "Brot", "sha": "0" * 64}
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "The note changed since you read it",
        "current": current,
    }


async def test_a_second_writer_on_a_stale_sha_rereads_and_keeps_both(
    client: AsyncClient, folder: Path
) -> None:
    put(folder, BLOCK + "# Einkauf\n\n")
    read_a = await client.get("/share/lists/Einkauf")
    read_b = await client.get("/share/lists/Einkauf")
    assert read_a.status_code == 200
    assert read_b.status_code == 200

    first = await client.post(
        "/share/lists/Einkauf/items", json={"text": "Milch", "sha": read_a.json()["sha"]}
    )
    stale = await client.post(
        "/share/lists/Einkauf/items", json={"text": "Brot", "sha": read_b.json()["sha"]}
    )
    reread = (await client.get("/share/lists/Einkauf")).json()
    retry = await client.post(
        "/share/lists/Einkauf/items", json={"text": "Brot", "sha": reread["sha"]}
    )

    assert first.status_code == 200
    assert stale.status_code == 409
    assert stale.json()["current"] == first.json()["sha"]
    assert retry.status_code == 200
    assert [item["text"] for item in retry.json()["items"]] == ["Milch", "Brot"]


async def test_tick_refuses_a_recurring_item(client: AsyncClient, folder: Path) -> None:
    # Kasten writes the next occurrence of a recurring todo. A tick here would
    # stop the series without that, so the share path leaves it to kasten.
    text = BLOCK + "- [ ] Milch 🔁 every week\n"
    sha = put(folder, text)

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "Tick this one in kasten"}
    assert (folder / "Einkauf.md").read_bytes() == text.encode("utf-8")


async def test_tick_refuses_an_item_with_parts(client: AsyncClient, folder: Path) -> None:
    # An indented task under the line is its parts, which kasten ticks with it.
    text = BLOCK + "- [ ] Einkauf\n  - [ ] Milch\n"
    sha = put(folder, text)

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "Tick this one in kasten"}
    assert (folder / "Einkauf.md").read_bytes() == text.encode("utf-8")


async def test_read_cuts_recurrence_waiting_and_block_ids(
    client: AsyncClient, folder: Path
) -> None:
    put(
        folder,
        BLOCK
        + "- [ ] Milch 🔁 every week\n"
        + "- [ ] Brot ^abc\n"
        + "- [ ] Butter #bio ⏳ 2026-10-21\n"
        + "- [ ] Eier 👤 Anna\n",
    )

    response = await client.get("/share/lists/Einkauf")

    assert [item["text"] for item in response.json()["items"]] == [
        "Milch",
        "Brot",
        "Butter #bio",
        "Eier",
    ]


async def test_1058_tick_keeps_a_trailing_block_id_last(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, BLOCK + "- [ ] Brot ^abc\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert re.search(rf"^- \[x\] Brot ✅ {today} 🆔 kt-[0-9a-f]{{6}} \^abc$", written, re.MULTILINE)


async def test_1058_untick_keeps_the_id_and_the_block_id(client: AsyncClient, folder: Path) -> None:
    sha = put(folder, BLOCK + "- [ ] Brot ^abc\n")
    ticked = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    response = await client.post(
        "/share/lists/Einkauf/tick",
        json={"line": 6, "done": False, "sha": ticked.json()["sha"]},
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    assert ticked.status_code == 200
    assert response.status_code == 200
    assert re.search(r"^- \[ \] Brot 🆔 kt-[0-9a-f]{6} \^abc$", written, re.MULTILINE)
    assert body_of(written).count("\n") == 2


async def test_1056_tick_keeps_a_bare_done_sign_among_the_words(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, BLOCK + "- [ ] Haken ✅ kaufen\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert re.search(
        rf"^- \[x\] Haken ✅ kaufen ✅ {today} 🆔 kt-[0-9a-f]{{6}}$", written, re.MULTILINE
    )


async def test_1056_tick_keeps_a_done_date_inside_a_code_span(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, BLOCK + "- [ ] see `✅ 2026-01-01`\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert re.search(
        rf"^- \[x\] see `✅ 2026-01-01` ✅ {today} 🆔 kt-[0-9a-f]{{6}}$", written, re.MULTILINE
    )


async def test_1056_untick_keeps_a_bare_done_sign_among_the_words(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, BLOCK + "- [x] Haken ✅ kaufen ✅ 2026-10-19 🆔 kt-000001\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": False, "sha": sha}
    )

    assert response.status_code == 200
    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n- [ ] Haken ✅ kaufen 🆔 kt-000001\n"
    )


async def test_1056_untick_keeps_a_done_date_inside_a_code_span(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, BLOCK + "- [x] see `✅ 2026-01-01` ✅ 2026-10-19 🆔 kt-000001\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": False, "sha": sha}
    )

    assert response.status_code == 200
    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n- [ ] see `✅ 2026-01-01` 🆔 kt-000001\n"
    )


async def test_1058_tick_keeps_the_id_before_a_trailing_block_id(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, BLOCK + "- [ ] Haken ✅ kaufen 🆔 kt-000001 ^abc\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        f"\n- [x] Haken ✅ kaufen ✅ {today} 🆔 kt-000001 ^abc\n"
    )


async def test_1058_tick_keeps_crlf_and_the_block_id_last(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    sha = put(folder, (BLOCK + "- [ ] Brot ^abc\n").replace("\n", "\r\n"))

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    written = (folder / "Einkauf.md").read_bytes().decode("utf-8")
    today = pinned_day.isoformat()
    assert response.status_code == 200
    assert re.search(
        rf"^- \[x\] Brot ✅ {today} 🆔 kt-[0-9a-f]{{6}} \^abc\r$", written, re.MULTILINE
    )


async def test_1058_read_after_a_tick_names_the_item_without_its_block_id(
    client: AsyncClient, folder: Path
) -> None:
    sha = put(folder, BLOCK + "- [ ] Brot ^abc\n")

    tick = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": True, "sha": sha}
    )

    assert tick.status_code == 200
    assert tick.json()["items"] == [
        {
            "line": 6,
            "text": "Brot",
            "done": True,
            "assignee": None,
            "ticked_by": None,
            "ticked_at": None,
        }
    ]


async def test_1056_untick_keeps_a_dateless_done_sign(client: AsyncClient, folder: Path) -> None:
    sha = put(folder, BLOCK + "- [x] Brot ✅ 🆔 kt-000001\n")

    response = await client.post(
        "/share/lists/Einkauf/tick", json={"line": 6, "done": False, "sha": sha}
    )

    assert response.status_code == 200
    assert body_of((folder / "Einkauf.md").read_text(encoding="utf-8")) == (
        "\n- [ ] Brot ✅ 🆔 kt-000001\n"
    )
