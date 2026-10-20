import json
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest import JJ, descriptions
from kasten_backend import agent
from kasten_backend.code_spans import code_spans, inside
from kasten_backend.config import Settings, get_settings
from kasten_backend.log import _log_lines
from kasten_backend.main import app
from kasten_backend.periodic import append_dump, daily_note

if TYPE_CHECKING:
    from httpx import AsyncClient

DAY = "01 Periodic/00 Daily/2026-09-29.md"

ID = "0b7e7c1e-3c55-4a8e-9f62-1d2a3b4c5d6e"
"""A capture id the way a phone mints one at typing."""

FIXTURE = Path(__file__).parents[2] / "frontend" / "tests" / "fixtures" / "daily-notes.json"
"""The daily notes `periodic.ts` must also produce, which its own test reads too."""


def body(text: str) -> str:
    """The note under its frontmatter, which the stamp dates to the second."""
    return text.split("\n---\n", 1)[1]


def test_makes_the_daily_note_the_periodic_key_makes() -> None:
    for day, expected in json.loads(FIXTURE.read_text()).items():
        assert daily_note(date.fromisoformat(day)) == expected


async def test_makes_the_note_where_the_vault_has_none(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/dump", json={"text": "call Jonas", "date": "2026-09-29"})

    assert response.status_code == 200
    written = (vault / DAY).read_text()
    assert response.json() == {"path": DAY, "content": written}
    assert "type: Periodic Note\n" in written
    assert "\nid: " in written
    assert body(written) == (
        "\n# 2026-09-29 Tuesday\n\n"
        "[[01 Periodic/00 Daily/2026-09-28]] | [[01 Periodic/01 Weekly/2026-W40]]"
        " | [[01 Periodic/00 Daily/2026-09-30]]\n\n"
        "## TODOs\n\n## Dump\ncall Jonas\n"
    )


async def test_adds_the_section_at_the_end_of_a_note_without_one(
    client: AsyncClient, vault: Path
) -> None:
    (vault / DAY).parent.mkdir(parents=True)
    (vault / DAY).write_text("---\nid: kept\n---\n# today\n\n## TODOs\n- [ ] a\n\n\n")

    await client.post("/api/dump", json={"text": "an idea", "date": "2026-09-29"})

    written = (vault / DAY).read_text()
    assert "id: kept\n" in written
    assert body(written) == "# today\n\n## TODOs\n- [ ] a\n\n## Dump\nan idea\n"


async def test_appends_a_paragraph_before_the_section_after_the_dump(
    client: AsyncClient, vault: Path
) -> None:
    (vault / DAY).parent.mkdir(parents=True)
    (vault / DAY).write_text("# today\n\n## Dump\nfirst\n\n## Inbox cleanup\n\nmoved\n")

    await client.post("/api/dump", json={"text": "second\nstill second", "date": "2026-09-29"})

    assert body((vault / DAY).read_text()) == (
        "# today\n\n## Dump\nfirst\n\nsecond\nstill second\n\n## Inbox cleanup\n\nmoved\n"
    )


async def test_appends_at_the_end_when_the_dump_is_last(client: AsyncClient, vault: Path) -> None:
    (vault / DAY).parent.mkdir(parents=True)
    (vault / DAY).write_text("# today\n\n## Dump\nfirst\n### a heading inside it\nstill the dump\n")

    await client.post("/api/dump", json={"text": "  trimmed  \n", "date": "2026-09-29"})

    # A `###` is part of what was dumped, so the section runs past it.
    assert body((vault / DAY).read_text()).endswith("still the dump\n\ntrimmed\n")


def test_a_dump_inside_a_fence_is_not_the_section() -> None:
    text = "# d\n\n```\n## Dump\n```\n\n## Dump\nold thought\n"

    assert append_dump(text, "new thought") == (
        "# d\n\n```\n## Dump\n```\n\n## Dump\nold thought\n\nnew thought\n"
    )


def test_a_heading_in_a_fence_inside_the_dump_does_not_end_it() -> None:
    text = "## Dump\nfirst\n```\n## x\n```\n"

    assert append_dump(text, "second") == "## Dump\nfirst\n```\n## x\n```\n\nsecond\n"


def test_a_dump_in_the_frontmatter_is_not_the_section() -> None:
    text = "---\nid: kept\n## Dump\n---\n# today\n"

    assert append_dump(text, "an idea") == (
        "---\nid: kept\n## Dump\n---\n# today\n\n## Dump\nan idea\n"
    )


def test_finds_a_dump_with_trailing_spaces_and_a_tab() -> None:
    text = "# d\n## Dump \t\nfirst\n"

    assert append_dump(text, "second") == "# d\n## Dump \t\nfirst\n\nsecond\n"


def test_makes_a_dump_at_the_end_when_the_only_one_is_fenced() -> None:
    text = "# d\n\n```\n## Dump\n```\n"

    assert append_dump(text, "new") == "# d\n\n```\n## Dump\n```\n\n## Dump\nnew\n"


def test_a_capture_that_opens_a_fence_is_closed_and_the_log_still_reads() -> None:
    text = "## Dump\na\n\n## Log\nwater 250ml\n"

    result = append_dump(text, "```")

    assert result == "## Dump\na\n\n```\n```\n\n## Log\nwater 250ml\n"
    assert _log_lines(result) == [(8, "water 250ml"), (9, "")]


def test_a_capture_into_a_dump_ending_in_an_unclosed_fence_lands_after_it() -> None:
    text = "## Dump\nfirst\n```\ncode\n"

    result = append_dump(text, "new")

    assert result == "## Dump\nfirst\n```\ncode\n```\n\nnew\n"
    assert not inside(result.index("new"), code_spans(result))


def test_a_dump_only_in_an_unclosed_fence_gets_the_fence_closed_and_one_live_dump() -> None:
    text = "# d\n\n```\n## Dump\nfirst\n"

    assert append_dump(append_dump(text, "one"), "two") == (
        "# d\n\n```\n## Dump\nfirst\n```\n\n## Dump\none\n\ntwo\n"
    )


def test_a_capture_keeps_its_text_and_gets_a_closer_as_long_as_its_opener() -> None:
    assert append_dump("## Dump\na\n", "```python\nprint(1)") == (
        "## Dump\na\n\n```python\nprint(1)\n```\n"
    )
    assert append_dump("## Dump\na\n", "````\nx") == "## Dump\na\n\n````\nx\n````\n"


def test_a_tilde_capture_is_closed_by_tildes() -> None:
    assert append_dump("## Dump\na\n", "~~~") == "## Dump\na\n\n~~~\n~~~\n"


def test_a_capture_with_a_closed_fence_is_written_as_it_came() -> None:
    assert append_dump("## Dump\na\n", "```\nx\n```") == "## Dump\na\n\n```\nx\n```\n"


def test_two_captures_into_a_dump_ending_in_an_unclosed_fence_leave_one_closer() -> None:
    text = "## Dump\nfirst\n```\ncode\n"

    assert append_dump(append_dump(text, "new"), "two") == (
        "## Dump\nfirst\n```\ncode\n```\n\nnew\n\ntwo\n"
    )


def test_an_open_fence_after_the_dump_is_left_alone() -> None:
    text = "## Dump\nfirst\n\n## Log\nwater\n```\ncode\n"

    assert append_dump(text, "new") == ("## Dump\nfirst\n\nnew\n\n## Log\nwater\n```\ncode\n")


def test_blank_lines_at_the_end_of_an_unclosed_fence_stay_inside_it() -> None:
    text = "## Dump\nfirst\n```\ncode\n\n\n"

    assert append_dump(text, "new") == "## Dump\nfirst\n```\ncode\n\n\n```\n\nnew\n"


def test_a_dump_inside_a_tilde_fence_is_not_the_section() -> None:
    text = "# d\n\n~~~\n## Dump\n~~~\n\n## Dump\nold thought\n"

    assert append_dump(text, "new thought") == (
        "# d\n\n~~~\n## Dump\n~~~\n\n## Dump\nold thought\n\nnew thought\n"
    )


def test_a_backtick_line_that_opens_no_fence_gets_the_real_fence_closed() -> None:
    text = "# d\n```x```\n```\n## Dump\nold\n"

    assert append_dump(text, "new") == "# d\n```x```\n```\n## Dump\nold\n```\n\n## Dump\nnew\n"


def test_a_capture_of_inline_triple_backtick_code_gets_no_closer() -> None:
    result = append_dump("## Dump\na\n\n## Log\nwater 250ml\n", "```npm i```")

    assert result == "## Dump\na\n\n```npm i```\n\n## Log\nwater 250ml\n"
    assert _log_lines(result) == [(7, "water 250ml"), (8, "")]


def test_a_note_ending_in_inline_triple_backtick_code_gets_no_closer() -> None:
    text = "## Dump\nfirst\n```x```"

    assert append_dump(text, "new") == "## Dump\nfirst\n```x```\n\nnew\n"


def test_a_fence_in_a_list_item_gets_no_column_zero_closer() -> None:
    text = "## Dump\n- item\n\n  ```\n  code\n"

    assert append_dump(text, "new") == "## Dump\n- item\n\n  ```\n  code\n\nnew\n"


def test_a_capture_with_a_fence_in_a_list_item_gets_no_column_zero_closer() -> None:
    result = append_dump("## Dump\na\n\n## Log\nwater 250ml\n", "- x\n\n  ```\n  code")

    assert result == "## Dump\na\n\n- x\n\n  ```\n  code\n\n## Log\nwater 250ml\n"
    log = _log_lines(result)
    assert log is not None and (10, "water 250ml") in log


def test_a_four_backtick_inline_span_leaves_a_closed_fence_closed() -> None:
    text = "# d\n````x```` y\n\n```\n## Dump\n```\n"

    assert append_dump(text, "new") == "# d\n````x```` y\n\n```\n## Dump\n```\n\n## Dump\nnew\n"


async def test_writes_into_the_day_the_sender_named(client: AsyncClient, vault: Path) -> None:
    await client.post("/api/dump", json={"text": "late", "date": "2027-01-01"})

    assert (vault / "01 Periodic/00 Daily/2027-01-01.md").is_file()


@pytest.mark.parametrize("text", ["", "   \n\t "])
async def test_refuses_text_with_nothing_in_it(client: AsyncClient, vault: Path, text: str) -> None:
    response = await client.post("/api/dump", json={"text": text, "date": "2026-09-29"})

    assert response.status_code == 422
    assert not (vault / DAY).exists()


async def test_refuses_a_date_that_is_not_one(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/dump", json={"text": "x", "date": "2026-02-30"})

    assert response.status_code == 422


@pytest.mark.skipif(JJ is None, reason="jj is not installed")
async def test_records_the_capture_as_a_change(client: AsyncClient, versioned_vault: Path) -> None:
    await client.post("/api/dump", json={"text": "call Jonas", "date": "2026-09-29"})

    assert descriptions(versioned_vault)[0] == f"vault: {DAY}"


@pytest.fixture
def receipts(vault: Path, tmp_path: Path) -> Path:
    """Where the ids written so far are kept, beside a token store in the test's own dir.

    The `vault` fixture's settings leave `tokens_path` at its cwd-relative
    default, which would put the receipts in the repo. This override replaces
    it, and the `vault` fixture's teardown clears it.
    """
    tokens = tmp_path / "tokens.json"
    app.dependency_overrides[get_settings] = lambda: Settings(vault_path=vault, tokens_path=tokens)
    return tokens.with_name("dump-receipts.json")


def paragraphs(vault: Path, text: str) -> int:
    """How many times `text` stands as a paragraph in the day's note."""
    return body((vault / DAY).read_text()).count(f"\n{text}\n")


def kept(receipts: Path) -> list[str] | None:
    """The ids the receipts file holds, or None when there is no file."""
    return json.loads(receipts.read_text()) if receipts.exists() else None


def seed(receipts: Path, ids: list[str]) -> None:
    """Leave `ids` in the receipts file, as an earlier run of the server would have."""
    receipts.write_text(json.dumps(ids))


async def test_a_retry_with_the_same_id_writes_one_paragraph(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    capture = {"text": "call Jonas", "date": "2026-09-29", "id": ID}

    first = await client.post("/api/dump", json=capture)
    # The answer to the first was lost, so the phone sends it again.
    second = await client.post("/api/dump", json=capture)

    assert second.status_code == 200
    assert second.json() == first.json() == {"path": DAY, "content": (vault / DAY).read_text()}
    assert paragraphs(vault, "call Jonas") == 1


async def test_two_ids_with_the_same_text_write_two_paragraphs(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    other = "5f0c2d1e-9a8b-4c7d-8e6f-0a1b2c3d4e5f"
    await client.post("/api/dump", json={"text": "water", "date": "2026-09-29", "id": ID})
    await client.post("/api/dump", json={"text": "water", "date": "2026-09-29", "id": other})

    assert paragraphs(vault, "water") == 2
    assert kept(receipts) == [ID, other]


async def test_two_captures_without_an_id_write_two_paragraphs(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    # An old client, or the agent's dump, which never sends one.
    for _ in range(2):
        await client.post("/api/dump", json={"text": "water", "date": "2026-09-29"})

    assert paragraphs(vault, "water") == 2
    assert kept(receipts) is None


async def test_the_receipts_are_read_from_disk(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    # Written by an earlier run of the server, which nothing in this process saw.
    seed(receipts, [ID])
    (vault / DAY).parent.mkdir(parents=True)
    (vault / DAY).write_text("# today\n\n## Dump\nfirst\n")

    capture = {"text": "again", "date": "2026-09-29", "id": ID}
    response = await client.post("/api/dump", json=capture)

    assert response.status_code == 200
    assert response.json() == {"path": DAY, "content": "# today\n\n## Dump\nfirst\n"}
    assert (vault / DAY).read_text() == "# today\n\n## Dump\nfirst\n"


async def test_the_receipts_keep_the_last_thousand_ids(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    seed(receipts, [f"old-{n}" for n in range(1000)])

    await client.post("/api/dump", json={"text": "new", "date": "2026-09-29", "id": ID})

    assert kept(receipts) == [*(f"old-{n}" for n in range(1, 1000)), ID]


async def test_a_failed_write_leaves_no_receipt(
    client: AsyncClient, vault: Path, receipts: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_: object) -> None:
        raise OSError("disk full")

    capture = {"text": "call Jonas", "date": "2026-09-29", "id": ID}
    with monkeypatch.context() as patch:
        patch.setattr(agent, "create_note", refuse)
        with pytest.raises(OSError, match="disk full"):
            await client.post("/api/dump", json=capture)

    assert kept(receipts) is None

    await client.post("/api/dump", json=capture)

    assert paragraphs(vault, "call Jonas") == 1
    assert kept(receipts) == [ID]


def spoil(receipts: Path, text: str) -> None:
    """Leave `text` in the receipts file, which no receipt write would have left."""
    receipts.write_text(text)


@pytest.mark.parametrize("text", ["{", "{}", "[1, 2]"])
async def test_a_corrupt_receipts_file_reads_as_none(
    client: AsyncClient, vault: Path, receipts: Path, text: str
) -> None:
    spoil(receipts, text)

    response = await client.post(
        "/api/dump", json={"text": "call Jonas", "date": "2026-09-29", "id": ID}
    )

    assert response.status_code == 200
    assert paragraphs(vault, "call Jonas") == 1
    # The next receipt write replaces what could not be read.
    assert kept(receipts) == [ID]


def unreadable(receipts: Path, kind: str) -> None:
    """Leave a receipts path that cannot be read as text: bytes not UTF-8, or a directory."""
    if kind == "bytes":
        receipts.write_bytes(b"\xff\xfe[]")
    else:
        receipts.mkdir()


@pytest.mark.parametrize("kind", ["bytes", "directory"])
async def test_an_unreadable_receipts_file_reads_as_none(
    client: AsyncClient, vault: Path, receipts: Path, kind: str
) -> None:
    unreadable(receipts, kind)

    response = await client.post(
        "/api/dump", json={"text": "call Jonas", "date": "2026-09-29", "id": ID}
    )

    # A directory cannot be replaced by the receipt write either, and the guard
    # around that write keeps the answer a 200.
    assert response.status_code == 200
    assert paragraphs(vault, "call Jonas") == 1


async def test_a_failed_receipt_write_still_answers_with_the_note(
    client: AsyncClient, vault: Path, receipts: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_: object) -> None:
        raise OSError("read-only")

    monkeypatch.setattr(agent, "_receipt", refuse)

    response = await client.post(
        "/api/dump", json={"text": "call Jonas", "date": "2026-09-29", "id": ID}
    )

    # The paragraph landed, so the phone must hear so and drop the record.
    assert response.status_code == 200
    assert response.json() == {"path": DAY, "content": (vault / DAY).read_text()}
    assert paragraphs(vault, "call Jonas") == 1


async def test_only_the_browser_capture_takes_an_id(client: AsyncClient) -> None:
    schema = (await client.get("/openapi.json")).json()

    def properties(route: str) -> dict[str, object]:
        body = schema["paths"][route]["post"]["requestBody"]["content"]["application/json"]
        name = body["schema"]["$ref"].rsplit("/", 1)[1]
        return schema["components"]["schemas"][name]["properties"]

    assert "id" in properties("/api/dump")
    assert "id" not in properties("/agent/dump")
