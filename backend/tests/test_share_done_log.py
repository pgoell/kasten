"""A tick through the lists app writes the done log line a tick in the todo pane writes (#726)."""

import hashlib
import json
import re
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest import descriptions
from kasten_backend import done_log
from kasten_backend.config import get_settings
from kasten_backend.periodic import daily_note, heading_lines

if TYPE_CHECKING:
    from collections.abc import Iterator

    from httpx import AsyncClient

FIXTURE = Path(__file__).parents[2] / "frontend" / "tests" / "fixtures" / "done-lines.json"
"""The lines and placements `doneLine` and `appendUnder` produce, which their own test reads too."""

CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))

LIST = "05 Shared/Einkauf"
"""The list every test ticks, as a link names it."""


def daily(vault: Path, day: date) -> Path:
    """Where the day's note sits."""
    return vault / "01 Periodic" / "00 Daily" / f"{day.isoformat()}.md"


def logged(vault: Path, day: date) -> list[str]:
    """The `- ✅` lines of the day's note, or none when there is no note."""
    note = daily(vault, day)
    if not note.is_file():
        return []
    return [
        line for line in note.read_text(encoding="utf-8").split("\n") if line.startswith("- ✅")
    ]


def put(folder: Path, text: str) -> str:
    """Write the list as given, and return the digest the routes report for it."""
    (folder / "Einkauf.md").write_bytes(text.encode("utf-8"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def tick(  # noqa: PLR0913  each part of the request is its own argument
    client: AsyncClient,
    folder: Path,
    item: str,
    *,
    done: bool = True,
    headers: dict[str, str] | None = None,
    day: str | None = None,
):
    """Tick or untick the item whose line starts with `item`, as the list stands on disk.

    By its words, since the first save stamps frontmatter on and moves every line.
    """
    raw = (folder / "Einkauf.md").read_bytes()
    lines = raw.decode("utf-8").split("\n")
    line = next(at for at, held in enumerate(lines) if held[6:].startswith(item))
    body = {"line": line, "done": done, "sha": hashlib.sha256(raw).hexdigest()}
    if day is not None:
        body["day"] = day
    return await client.post("/share/lists/Einkauf/tick", json=body, headers=headers)


@pytest.fixture
def folder(agent_vault: Path) -> Path:
    """The share folder, empty, in the agent's vault."""
    path = agent_vault / "05 Shared"
    path.mkdir()
    return path


@pytest.mark.parametrize("case", CASES["lines"], ids=[case["name"] for case in CASES["lines"]])
def test_726_done_line_matches_the_todo_pane_cases(case: dict[str, str]) -> None:
    rest = case["line"].removeprefix("- [x] ")

    assert done_log.done_line(rest, case["path"], case["daily"], case["today"]) == case["logged"]


@pytest.mark.parametrize(
    "case", CASES["placements"], ids=[case["name"] for case in CASES["placements"]]
)
def test_726_done_log_places_the_line_where_the_todo_pane_does(case: dict[str, str]) -> None:
    assert done_log.append_under(case["note"], "## Done", case["line"]) == case["written"]


@pytest.mark.parametrize("case", CASES["reads"], ids=[case["name"] for case in CASES["reads"]])
def test_754_the_log_reads_the_lines_the_card_reads(case: dict[str, str]) -> None:
    lines = heading_lines(case["note"], "## Log") or []

    assert [line for _, line in lines if line.startswith("- ")] == case["entries"]


async def test_726_share_tick_writes_one_done_log_line_in_todays_daily_note(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    put(folder, "- [ ] Milch #bio 👤 [[Anna]]\n")

    response = await tick(client, folder, "Milch")

    item = (folder / "Einkauf.md").read_text(encoding="utf-8")
    found = re.search(r"🆔 (kt-[0-9a-f]{6})", item)
    assert response.status_code == 200
    assert found is not None
    today = pinned_day.isoformat()
    assert logged(folder.parent, pinned_day) == [f"- ✅ {today} Milch #bio [[{LIST}]] {found[1]}"]


async def test_726_a_missing_daily_note_is_made_as_leader_gd_makes_it(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    put(folder, "- [ ] Milch 🆔 kt-000001\n")

    await tick(client, folder, "Milch")

    template = daily_note(pinned_day).split("\n---\n", 1)[1]
    written = daily(folder.parent, pinned_day).read_text(encoding="utf-8").split("\n---\n", 1)[1]
    line = f"- ✅ {pinned_day.isoformat()} Milch [[{LIST}]] kt-000001"
    assert written == done_log.append_under(template, "## Done", line)


async def test_726_second_tick_writes_no_second_line(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    put(folder, "- [ ] Milch\n")

    await tick(client, folder, "Milch")
    again = await tick(client, folder, "Milch")

    assert again.status_code == 200
    assert len(logged(folder.parent, pinned_day)) == 1


async def test_726_a_tick_of_an_id_logged_elsewhere_writes_no_second_line(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    # An older day already holds the line, as after a hand edit reopened the
    # item: the pane skips an id logged anywhere, and so does the share tick.
    older = date(2026, 10, 1)
    daily(folder.parent, older).parent.mkdir(parents=True)
    daily(folder.parent, older).write_text("## Done\n- ✅ 2026-10-01 Brot kt-000001\n")
    put(folder, "- [ ] Brot 🆔 kt-000001\n- [ ] Milch\n")

    await tick(client, folder, "Brot")
    await tick(client, folder, "Milch")

    assert len(logged(folder.parent, older)) == 1
    assert [line for line in logged(folder.parent, pinned_day) if "kt-000001" in line] == []
    assert len(logged(folder.parent, pinned_day)) == 1


async def test_726_untick_drops_the_done_log_line(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    put(folder, "- [ ] Milch\n- [ ] Brot\n")

    await tick(client, folder, "Milch")
    await tick(client, folder, "Brot")
    response = await tick(client, folder, "Milch", done=False)

    assert response.status_code == 200
    assert len(logged(folder.parent, pinned_day)) == 1
    assert " Brot " in logged(folder.parent, pinned_day)[0]


async def test_726_untick_drops_the_line_from_an_older_daily_note(
    client: AsyncClient, folder: Path
) -> None:
    older = date(2026, 10, 1)
    daily(folder.parent, older).parent.mkdir(parents=True)
    daily(folder.parent, older).write_text(
        "## Done\n- ✅ 2026-10-01 Brot kt-000001\n- ✅ 2026-10-01 Tee kt-000002\n"
    )
    put(folder, "- [x] Brot ✅ 2026-10-01 🆔 kt-000001\n")

    await tick(client, folder, "Brot", done=False)

    assert logged(folder.parent, older) == ["- ✅ 2026-10-01 Tee kt-000002"]


@pytest.mark.parametrize(
    "refusal",
    [
        ("Unter/Einkauf", 0, None, 404),
        ("Einkauf", 5, None, 200),
        ("Einkauf", 0, "0" * 64, 409),
        ("Einkauf", 1, None, 422),
    ],
    ids=["bad name", "gone item", "stale sha", "recurring item"],
)
async def test_726_refused_tick_writes_no_done_log_line(
    client: AsyncClient, folder: Path, refusal: tuple[str, int, str | None, int], pinned_day: date
) -> None:
    name, line, sha, status = refusal
    current = put(folder, "- [ ] Milch\n- [ ] Wasser 🔁 every week\n")

    refused = await client.post(
        f"/share/lists/{name}/tick", json={"line": line, "done": True, "sha": sha or current}
    )
    written_after_refusal = daily(folder.parent, pinned_day).is_file()
    await tick(client, folder, "Milch")

    assert refused.status_code == status
    assert not written_after_refusal
    assert len(logged(folder.parent, pinned_day)) == 1


async def test_726_logs_done_off_leaves_the_daily_note_alone(
    client: AsyncClient, folder: Path, monkeypatch: pytest.MonkeyPatch, pinned_day: date
) -> None:
    put(folder, "- [ ] Milch\n- [ ] Brot\n")

    monkeypatch.setenv("KASTEN_SHARE_LOGS_DONE", "false")
    get_settings.cache_clear()
    await tick(client, folder, "Milch")
    written_while_off = daily(folder.parent, pinned_day).is_file()
    monkeypatch.setenv("KASTEN_SHARE_LOGS_DONE", "true")
    get_settings.cache_clear()
    await tick(client, folder, "Brot")

    assert not written_while_off
    assert len(logged(folder.parent, pinned_day)) == 1


@pytest.fixture
def people(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """One listed person, read from the environment the way production reads it."""
    monkeypatch.setenv("KASTEN_SHARE_PEOPLE", '{"pascal@example.test": "Pascal"}')
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.usefixtures("people")
async def test_726_the_daily_write_names_the_share_person_in_history(
    client: AsyncClient, versioned_agent_vault: Path, pinned_day: date
) -> None:
    folder = versioned_agent_vault / "05 Shared"
    folder.mkdir()
    put(folder, "- [ ] Milch\n")

    await tick(client, folder, "Milch", headers={"X-Auth-Request-Email": "pascal@example.test"})

    path = f"01 Periodic/00 Daily/{pinned_day.isoformat()}.md"
    assert f"agent(share:Pascal): {path}" in descriptions(versioned_agent_vault)


@pytest.mark.parametrize("case", CASES["drops"], ids=[case["name"] for case in CASES["drops"]])
def test_1301_drop_done_matches_the_todo_pane_cases(case: dict[str, str]) -> None:
    assert done_log.drop_done(case["note"], case["id"]) == case["kept"]


def older_day(vault: Path, text: str) -> Path:
    """An older daily note holding `text`, which an untick has to visit to find a line."""
    note = daily(vault, date(2026, 10, 1))
    note.parent.mkdir(parents=True)
    note.write_text(text, encoding="utf-8")
    return note


async def test_1301_untick_keeps_a_log_line_of_another_todo_naming_the_id(
    client: AsyncClient, folder: Path
) -> None:
    text = "## Done\n- ✅ 2026-10-01 fixed kt-000001 [[X]] kt-999999\n"
    note = older_day(folder.parent, text)
    put(folder, "- [x] Brot ✅ 2026-10-01 🆔 kt-000001\n")

    response = await tick(client, folder, "Brot", done=False)

    assert response.status_code == 200
    assert note.read_text(encoding="utf-8") == text


async def test_1301_untick_keeps_a_fenced_log_line(client: AsyncClient, folder: Path) -> None:
    text = "```\n- ✅ 2026-10-01 Brot kt-000001\n```\n"
    note = older_day(folder.parent, text)
    put(folder, "- [x] Brot ✅ 2026-10-01 🆔 kt-000001\n")

    await tick(client, folder, "Brot", done=False)

    assert note.read_text(encoding="utf-8") == text


async def test_1301_untick_drops_its_own_line_with_words_after_the_id(
    client: AsyncClient, folder: Path
) -> None:
    older_day(folder.parent, "## Done\n- ✅ 2026-10-01 Brot kt-000001 -> its 2026.11.13\n")
    put(folder, "- [x] Brot ✅ 2026-10-01 🆔 kt-000001\n")

    await tick(client, folder, "Brot", done=False)

    assert logged(folder.parent, date(2026, 10, 1)) == []


async def test_1301_tick_logs_an_id_that_stands_only_in_another_log_line(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    older_day(folder.parent, "## Done\n- ✅ 2026-10-01 fixed kt-000001 [[X]] kt-999999\n")
    put(folder, "- [ ] Brot 🆔 kt-000001\n")

    await tick(client, folder, "Brot")

    assert [line for line in logged(folder.parent, pinned_day) if line.endswith(" kt-000001")] != []


@pytest.mark.parametrize(
    ("twin", "where"),
    [
        (None, "05 Shared/Einkauf.md line 2"),
        ("02 Projects/Other.md", "02 Projects/Other.md line 1"),
    ],
    ids=["in the list", "in another note"],
)
async def test_1301_untick_refuses_an_id_two_todos_carry_and_writes_nothing(
    client: AsyncClient, folder: Path, twin: str | None, where: str
) -> None:
    log = "## Done\n- ✅ 2026-10-01 Brot kt-000001\n"
    note = older_day(folder.parent, log)
    copy = "- [x] Brot ✅ 2026-10-01 🆔 kt-000001\n"
    if twin is None:
        text = copy + copy
    else:
        text = copy
        (folder.parent / twin).parent.mkdir(parents=True)
        (folder.parent / twin).write_text("- [ ] Brot 🆔 kt-000001\n", encoding="utf-8")
    put(folder, text)

    response = await tick(client, folder, "Brot", done=False)

    assert response.status_code == 422
    assert response.json()["detail"] == f"🆔 kt-000001 is on another todo too: {where}"
    assert (folder / "Einkauf.md").read_text(encoding="utf-8") == text
    assert note.read_text(encoding="utf-8") == log


@pytest.mark.parametrize(
    ("twin", "where"),
    [
        (None, "05 Shared/Einkauf.md line 2"),
        ("02 Projects/Other.md", "02 Projects/Other.md line 1"),
    ],
    ids=["in the list", "in another note"],
)
async def test_1303_tick_refuses_an_id_two_todos_carry_and_writes_nothing(
    client: AsyncClient, folder: Path, twin: str | None, where: str, pinned_day: date
) -> None:
    copy = "- [ ] Brot 🆔 kt-000001\n"
    text = copy + copy if twin is None else copy
    if twin is not None:
        (folder.parent / twin).parent.mkdir(parents=True)
        (folder.parent / twin).write_text(copy, encoding="utf-8")
    put(folder, text)

    response = await tick(client, folder, "Brot")

    assert response.status_code == 422
    assert response.json()["detail"] == f"🆔 kt-000001 is on another todo too: {where}"
    assert (folder / "Einkauf.md").read_text(encoding="utf-8") == text
    assert not daily(folder.parent, pinned_day).is_file()


async def test_1303_logs_done_off_ticks_an_id_two_todos_carry(
    client: AsyncClient, folder: Path, monkeypatch: pytest.MonkeyPatch, pinned_day: date
) -> None:
    put(folder, "- [ ] Brot 🆔 kt-000001\n- [ ] Brot 🆔 kt-000001\n")
    monkeypatch.setenv("KASTEN_SHARE_LOGS_DONE", "false")
    get_settings.cache_clear()

    response = await tick(client, folder, "Brot")

    assert response.status_code == 200
    assert response.json()["items"][0]["done"]


async def test_1300_a_tick_stamps_and_logs_the_day_the_lists_app_sends(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    put(folder, "- [ ] Milch\n")

    response = await tick(client, folder, "Milch", day="2020-01-15")

    assert response.status_code == 200
    assert "✅ 2020-01-15 🆔 kt-" in (folder / "Einkauf.md").read_text(encoding="utf-8")
    assert len(logged(folder.parent, date(2020, 1, 15))) == 1
    assert not daily(folder.parent, pinned_day).is_file()


async def test_1300_an_untick_with_a_day_drops_its_stamp_and_log_line(
    client: AsyncClient, folder: Path
) -> None:
    put(folder, "- [ ] Milch\n")
    await tick(client, folder, "Milch", day="2020-01-15")

    response = await tick(client, folder, "Milch", done=False, day="2020-01-16")

    assert response.status_code == 200
    assert "- [ ] Milch 🆔 kt-" in (folder / "Einkauf.md").read_text(encoding="utf-8")
    assert logged(folder.parent, date(2020, 1, 15)) == []


@pytest.mark.parametrize("day", ["15.01.2020", "2020-13-01", "today"])
async def test_1300_a_day_that_is_no_date_is_refused_and_writes_nothing(
    client: AsyncClient, folder: Path, day: str
) -> None:
    text = "- [ ] Milch\n"
    put(folder, text)

    response = await tick(client, folder, "Milch", day=day)

    assert response.status_code == 422
    assert (folder / "Einkauf.md").read_text(encoding="utf-8") == text


async def test_1059_tick_reads_no_id_glued_to_an_estimate(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    put(folder, "- [ ] a ⏲ 5m🆔 kt-1\n")

    response = await tick(client, folder, "a ")

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    today = pinned_day.isoformat()
    found = re.search(rf"^- \[x\] a ⏲ 5m🆔 kt-1 ✅ {today} 🆔 (kt-[0-9a-f]{{6}})$", written, re.M)
    assert response.status_code == 200
    assert found is not None
    assert logged(folder.parent, pinned_day) == [f"- ✅ {today} a kt-1 [[{LIST}]] {found[1]}"]
    await tick(client, folder, "a ", done=False)
    assert logged(folder.parent, pinned_day) == []


@pytest.mark.parametrize(
    ("rest", "undone"),
    [
        ("Brot ✅ 2026-01-015 🆔 kt-1", "Brot 5 🆔 kt-1"),
        ("Brot ✅ 2026-01-01 🆔 kt-1", "Brot 🆔 kt-1"),
        ("Brot ✅ 2026-01-01", "Brot"),
        ("✅ 2026-01-01x", "x"),
        ("Brot✅ 2026-01-01 mehr", "Brot mehr"),
        ("Brot✅ 2026-01-01📅 2026-02-02", "Brot📅 2026-02-02"),
        ("Brot✅ 2026-01-01", "Brot"),
        ("Brot\N{NO-BREAK SPACE}✅ 2026-01-01mehr", "Brot\N{NO-BREAK SPACE}mehr"),
        ("Brot✅ 2026-01-01\N{NO-BREAK SPACE}mehr", "Brot\N{NO-BREAK SPACE}mehr"),
    ],
)
async def test_1066_untick_joins_no_words_where_the_done_date_was(
    client: AsyncClient, folder: Path, rest: str, undone: str
) -> None:
    put(folder, f"- [x] {rest}\n")

    response = await tick(client, folder, rest[:4], done=False)

    assert response.status_code == 200
    assert (folder / "Einkauf.md").read_text(encoding="utf-8").endswith(f"\n- [ ] {undone}\n")


@pytest.mark.parametrize(
    ("rest", "undone", "text"),
    [
        ("Brot✅ 2026-01-01mehr\n", "Brot mehr\n", "Brot mehr"),
        ("Brot✅ 2026-01-01mehr 🆔 kt-1 ^abc\n", "Brot mehr 🆔 kt-1 ^abc\n", "Brot mehr"),
        ("Brot✅ 2026-01-01mehr\r\n", "Brot mehr\r\n", "Brot mehr"),
        ("Brot✅ 2026-01-01^abc\n", "Brot ^abc\n", "Brot"),
    ],
)
async def test_1491_untick_keeps_apart_the_words_a_glued_done_field_split(
    client: AsyncClient, folder: Path, rest: str, undone: str, text: str
) -> None:
    put(folder, f"- [x] {rest}")

    response = await tick(client, folder, "Brot", done=False)

    written = (folder / "Einkauf.md").read_bytes().decode("utf-8")
    assert response.status_code == 200
    assert written.endswith(f"\n- [ ] {undone}")
    assert [item["text"] for item in response.json()["items"]] == [text]


async def test_1491_tick_after_the_untick_keeps_the_words_apart(
    client: AsyncClient, folder: Path, pinned_day: date
) -> None:
    put(folder, "- [x] Brot✅ 2026-01-01mehr 🆔 kt-1\n")
    await tick(client, folder, "Brot", done=False)

    response = await tick(client, folder, "Brot")

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    assert response.status_code == 200
    assert written.endswith(f"\n- [x] Brot mehr ✅ {pinned_day.isoformat()} 🆔 kt-1\n")


NBSP = "\N{NO-BREAK SPACE}"


@pytest.mark.parametrize(
    ("rest", "words", "block"),
    [
        ("^abc", "", " ^abc"),
        ("Brot ^abc", "Brot ", " ^abc"),
        (f"Brot{NBSP}^abc", f"Brot{NBSP}^abc ", ""),
        ("x^2", "x^2 ", ""),
    ],
)
@pytest.mark.usefixtures("pinned_day")
async def test_1067_tick_keeps_last_the_block_id_the_read_takes(
    client: AsyncClient, folder: Path, rest: str, words: str, block: str
) -> None:
    put(folder, f"- [ ] {rest}\n")
    shown = (await client.get("/share/lists/Einkauf")).json()["items"][0]["text"]

    await tick(client, folder, rest[:1])

    written = (folder / "Einkauf.md").read_text(encoding="utf-8")
    line = rf"- \[x\] {re.escape(words)}✅ \S+ 🆔 kt-[0-9a-f]{{6}}"
    assert re.search(rf"^{line}{re.escape(block)}$", written, re.MULTILINE)
    assert shown == words.strip()
