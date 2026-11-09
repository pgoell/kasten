"""`Done` and `Tomorrow` on a reminder, which find their line by its text (#1682)."""

import datetime as dt
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

import pytest

from backend.tests.push.conftest import PushService, note, subscribe
from kasten_backend.push import tick
from kasten_backend.push.due import put_off

if TYPE_CHECKING:
    import httpx
    from sqlalchemy.ext.asyncio import AsyncEngine

    from kasten_backend.config import Settings

PATH = "Notes/Errands.md"
LINE = "- [ ] call the dentist ⏰ 2026-11-12 09:00"


def _today() -> dt.date:
    return dt.datetime.now(ZoneInfo("Europe/Berlin")).date()


def _read(settings: Settings, path: str = PATH) -> str:
    """The note's text after the frontmatter a save stamps."""
    text = (settings.vault_path / path).read_text(encoding="utf-8")
    return text.split("---\n", 2)[2] if text.startswith("---\n") else text


def _daily(settings: Settings) -> str:
    target = settings.vault_path / f"01 Periodic/00 Daily/{_today().isoformat()}.md"
    return target.read_text(encoding="utf-8") if target.is_file() else ""


async def _act(client: httpx.AsyncClient, action: str, text: str = LINE) -> int:
    answer = await client.post("/api/push/act", json={"path": PATH, "text": text, "action": action})
    return answer.status_code


async def test_1682_done_ticks_the_line_found_by_its_text_where_it_moved(
    client: httpx.AsyncClient, served: Settings
) -> None:
    note(served, f"# Errands\n\n{LINE}\n  - [ ] find the card\n", PATH)
    note(served, f"# Errands\n\nnew line\nanother\n\n{LINE}\n  - [ ] find the card\n", PATH)
    assert await _act(client, "done") == 204
    lines = _read(served).split("\n")
    today = _today().isoformat()
    assert lines[5].startswith(f"- [x] call the dentist ⏰ 2026-11-12 09:00 ✅ {today} 🆔 kt-")
    assert lines[6] == f"  - [x] find the card ✅ {today}"
    assert lines[2:5] == ["new line", "another", ""]
    id_ = lines[5].rsplit(" ", 1)[1]
    assert f"- ✅ {today} call the dentist" in _daily(served)
    assert id_ in _daily(served)


async def test_1682_tomorrow_moves_the_alarm_a_day_on_where_the_line_moved(
    client: httpx.AsyncClient, served: Settings
) -> None:
    note(served, f"# Errands\n\nnew line\n{LINE}\n", PATH)
    assert await _act(client, "tomorrow") == 204
    tomorrow = (_today() + dt.timedelta(days=1)).isoformat()
    assert _read(served) == f"# Errands\n\nnew line\n- [ ] call the dentist ⏰ {tomorrow} 09:00\n"
    assert _daily(served) == ""


@pytest.mark.parametrize("action", ["done", "tomorrow"])
@pytest.mark.parametrize(
    "body",
    [
        "# Errands\n\n- [ ] call the dentist about the bill ⏰ 2026-11-12 09:00\n",
        f"# Errands\n\n{LINE}\n{LINE}\n",
        "# Errands\n\n- [x] call the dentist ⏰ 2026-11-12 09:00\n",
    ],
    ids=["text gone", "two lines with its text", "done already"],
)
async def test_1682_an_act_whose_line_is_gone_or_twinned_writes_nothing(
    client: httpx.AsyncClient, served: Settings, action: str, body: str
) -> None:
    note(served, body, PATH)
    assert await _act(client, action) == 409
    assert _read(served) == body
    assert _daily(served) == ""


async def test_1682_an_act_on_a_note_that_is_gone_writes_nothing(
    client: httpx.AsyncClient, served: Settings
) -> None:
    assert await _act(client, "done") == 409
    assert not (served.vault_path / PATH).exists()


@pytest.mark.parametrize(
    ("line", "other"),
    [
        ("- [ ] pay rent 🔁 every month ⏰ 2026-11-12 09:00", ""),
        ("- [ ] pay rent ⏰ 2026-11-12 09:00 🆔 kt-aaa111", "- [ ] copy 🆔 kt-aaa111\n"),
        ("- [ ] pay rent ⏰ 2026-11-12 09:00 🆔 kt-aaa111", "- [ ] then this ⛔ kt-aaa111\n"),
    ],
    ids=["recurring", "id on another todo", "id a blocker names"],
)
async def test_1682_done_the_pane_writes_more_for_is_refused_and_writes_nothing(
    client: httpx.AsyncClient, served: Settings, line: str, other: str
) -> None:
    body = f"# Errands\n\n{line}\n"
    note(served, body, PATH)
    note(served, other, "Other.md")
    assert await _act(client, "done", line) == 422
    assert _read(served) == body
    assert _daily(served) == ""


def test_1682_put_off_moves_only_the_alarm_the_reader_takes() -> None:
    line = "- [ ] read `⏰ 2026-01-01 08:00` then ⏰ 2026-11-12 09:00 📅 2026-11-12\r"
    assert put_off(line, dt.date(2026, 11, 20)) == (
        "- [ ] read `⏰ 2026-01-01 08:00` then ⏰ 2026-11-21 09:00 📅 2026-11-12\r"
    )
    assert put_off("- [ ] no alarm", dt.date(2026, 11, 20)) is None


async def test_1682_a_reminder_carries_its_line_and_after_tomorrow_waits_a_day(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    now = dt.datetime.now(ZoneInfo("Europe/Berlin")).replace(second=0, microsecond=0)
    line = f"  - [ ] call the dentist ⏰ {now.date().isoformat()} {now:%H:%M}"
    note(served, f"# Errands\n\n- [ ] errands\n{line}\n", PATH)
    async with service.client() as http:
        assert await tick(push_db, served, http, now) == 1
        assert service.sent[0][1]["text"] == line
        assert await _act(client, "tomorrow", line) == 204
        assert await tick(push_db, served, http, now + dt.timedelta(minutes=1)) == 0
        assert await tick(push_db, served, http, now + dt.timedelta(days=1)) == 1
