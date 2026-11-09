"""Push reminders: the RFC 8291 payload, the VAPID token, the devices routes and the todo sender."""

import asyncio
import datetime as dt
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from backend.tests.push.conftest import KEY, PUBLIC, PushService, note, subscribe
from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app
from kasten_backend.push import PushDevice, tick
from kasten_backend.push.due import reminder_of, reminders, today_todos
from kasten_backend.push.loop import PUSH_LOCK
from kasten_backend.push.webpush import encrypt, private_key, unb64, vapid
from kasten_backend.search import Hit
from kasten_backend.todos import find_todos

if TYPE_CHECKING:
    from pathlib import Path

BERLIN = ZoneInfo("Europe/Berlin")
NOW = dt.datetime(2026, 11, 12, 9, 0, tzinfo=BERLIN)


def _rfc(text_: str) -> bytes:
    return unb64("".join(text_.split()))


def test_encrypt_gives_rfc_8291_appendix_a_byte_for_byte() -> None:
    server = private_key("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
    body = encrypt(
        _rfc("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        "BTBZMqHH6r4Tts7J_aSIgg",
        salt=_rfc("DGv6ra1nlYgDCS1FRnbzlw"),
        server=server,
    )
    header = _rfc(
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
        "mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8"
    )
    cipher = _rfc(
        "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ"
    )
    assert body == header + cipher


def test_vapid_token_verifies_for_the_endpoint_origin() -> None:
    header = vapid("https://fcm.googleapis.com/fcm/send/abc", KEY, now=1_800_000_000)
    token = header.removeprefix("vapid t=").split(", k=")[0]
    assert header.endswith(f", k={PUBLIC}")
    public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64(PUBLIC))
    pem = public.public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    claims = jwt.decode(
        token,
        pem,
        algorithms=["ES256"],
        audience="https://fcm.googleapis.com",
        options={"verify_exp": False},
    )
    assert claims["sub"].startswith("https://")


@pytest.mark.parametrize(
    ("line", "words", "due"),
    [
        ("- [ ] call the dentist ⏰ 2026-11-12 09:00", "call the dentist", "09:00"),
        ("- [/] water ⏰️ 2026-11-12 08:30 📅 2026-11-12 #health", "water #health", "08:30"),
        ("  - [ ] nested ⏰ 2026-11-12 09:00 ^abc", "nested", "09:00"),
    ],
)
def test_a_reminder_reads_its_words_and_time_in_the_zone(line: str, words: str, due: str) -> None:
    found = reminder_of(Hit("a.md", 3, line), BERLIN)
    assert found is not None
    assert found.words == words
    assert found.due == dt.datetime.fromisoformat(f"2026-11-12T{due}").replace(tzinfo=BERLIN)
    assert found.due.utcoffset() == dt.timedelta(hours=1)


@pytest.mark.parametrize(
    "line",
    [
        "- [x] done ⏰ 2026-11-12 09:00",
        "- [X] done ⏰ 2026-11-12 09:00",
        "- [-] cancelled ⏰ 2026-11-12 09:00",
        "- [x] done on a CRLF line ⏰ 2026-11-12 09:00\r",
        "- [ ] in code `⏰ 2026-11-12 09:00`",
        "- [ ] bad hour ⏰ 2026-11-12 25:00",
        "- [ ] no such day ⏰ 2026-02-30 09:00",
        "- [ ] no time ⏰ 2026-11-12",
        "- not a todo ⏰ 2026-11-12 09:00",
    ],
)
def test_a_closed_coded_or_malformed_reminder_is_none(line: str) -> None:
    assert reminder_of(Hit("a.md", 1, line), BERLIN) is None


@pytest.mark.parametrize("end", ["\r\n", "\r"])
async def test_1703_a_crlf_or_bare_cr_line_reads_as_its_lf_line(tmp_path: Path, end: str) -> None:
    line = "- [ ] call the dentist ⏰ 2026-11-12 09:00 📅 2026-11-12"
    (tmp_path / "lf").mkdir()
    (tmp_path / "lf" / "a.md").write_text(f"# A\n\n{line}\n", encoding="utf-8")
    (tmp_path / "cr").mkdir()
    (tmp_path / "cr" / "a.md").write_text(f"# A\n\n{line}{end}", encoding="utf-8")
    lf, cr = await find_todos(tmp_path / "lf"), await find_todos(tmp_path / "cr")
    assert reminders(cr, BERLIN) == reminders(lf, BERLIN) != []
    assert [found.key for found in reminders(cr, BERLIN)] == [r.key for r in reminders(lf, BERLIN)]
    assert today_todos(cr, NOW.date()) == today_todos(lf, NOW.date()) == ["call the dentist"]


async def test_devices_are_listed_and_one_endpoint_is_one_device(
    client: httpx.AsyncClient, served: Settings
) -> None:
    service = PushService()
    phone = service.device("phone")
    first = (await client.post("/api/push/devices", json=phone)).json()
    again = (await client.post("/api/push/devices", json={**phone, "name": "Pixel"})).json()
    await subscribe(client, service, "laptop")
    listed = (await client.get("/api/push")).json()
    assert listed["public_key"] == PUBLIC
    assert first["id"] == again["id"]
    assert [d["name"] for d in listed["devices"]] == ["Pixel", "laptop"]
    assert "p256dh" not in listed["devices"][0]


async def test_a_device_is_removed(client: httpx.AsyncClient, served: Settings) -> None:
    ids = await subscribe(client, PushService(), "phone", "laptop")
    assert (await client.delete(f"/api/push/devices/{ids[0]}")).status_code == 204
    assert (await client.delete(f"/api/push/devices/{ids[0]}")).status_code == 404
    assert [d["id"] for d in (await client.get("/api/push")).json()["devices"]] == [ids[1]]


async def test_with_no_key_push_is_not_set_up(
    client: httpx.AsyncClient, settings: Settings, push_db: AsyncEngine, activity: AsyncEngine
) -> None:
    bare = Settings(vault_path=settings.vault_path)
    app.dependency_overrides[get_settings] = lambda: bare
    try:
        assert (await client.get("/api/push")).json() == {"public_key": None, "devices": []}
        answer = await client.post("/api/push/devices", json=PushService().device("phone"))
        assert answer.status_code == 503
        timer = {"label": "Washer", "due": NOW.isoformat()}
        assert (await client.post("/api/push/timers", json=timer)).status_code == 503
    finally:
        app.dependency_overrides.pop(get_settings)
    async with PushService().client() as http:
        assert await tick(push_db, bare, http, NOW) == 0


async def test_a_reminder_due_now_goes_to_every_device_with_its_note(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone", "laptop")
    note(served, "# Today\n\n- [ ] call the dentist ⏰ 2026-11-12 09:00\n", "01 Periodic/Today.md")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 1
    assert sorted(endpoint for endpoint, _ in service.sent) == [
        "https://push.example/laptop",
        "https://push.example/phone",
    ]
    message = service.sent[0][1]
    assert message["body"] == "call the dentist"
    assert (message["path"], message["line"]) == ("01 Periodic/Today.md", 3)


@pytest.mark.parametrize(
    "text",
    [
        "# Today\r\n\r\n- [ ] call the dentist ⏰ 2026-11-12 09:00\r\n",
        "# Today\n\n- [ ] call the dentist ⏰ 2026-11-12 09:00\r",
    ],
)
async def test_1703_a_crlf_note_sends_its_reminder(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine, text: str
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    note(served, text, "01 Periodic/Today.md")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 1
    [(_, message)] = service.sent
    assert message["body"] == "call the dentist"
    assert (message["path"], message["line"]) == ("01 Periodic/Today.md", 3)


async def test_a_reminder_not_yet_due_waits(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    note(served, "- [ ] later ⏰ 2026-11-12 09:01\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 0
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=1)) == 1


@pytest.mark.parametrize(("late", "sent"), [(59, 1), (60, 0), (61, 0), (180, 0)])
async def test_a_missed_reminder_goes_late_under_an_hour_and_is_dropped_after(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine, late: int, sent: int
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    note(served, "- [ ] missed ⏰ 2026-11-12 09:00\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=late)) == sent
        # A dropped one stays dropped: it never becomes due again.
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=late + 1)) == 0
    assert len(service.sent) == sent


async def test_a_restart_after_a_send_does_not_send_again(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine, scratch_database: str
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 1
    # A new process: its own engine and client, nothing kept in memory; a line added above.
    note(served, "# Today\n\n- [ ] once ⏰ 2026-11-12 09:00\n")
    fresh = create_async_engine(scratch_database, poolclass=NullPool)
    try:
        async with service.client() as http:
            assert await tick(fresh, served, http, NOW + dt.timedelta(minutes=5)) == 0
    finally:
        await fresh.dispose()
    assert len(service.sent) == 1


async def test_two_workers_send_once(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine, scratch_database: str
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
    other = create_async_engine(scratch_database, poolclass=NullPool)
    try:
        # Another worker holds the lock: this one sends nothing, and does not wait.
        async with other.connect() as holder:
            assert await holder.scalar(select(func.pg_try_advisory_lock(PUSH_LOCK)))
            async with service.client() as http:
                assert await tick(push_db, served, http, NOW) == 0
            await holder.execute(select(func.pg_advisory_unlock(PUSH_LOCK)))
        async with service.client() as http:
            counts = await asyncio.gather(
                *(tick(engine, served, http, NOW) for engine in (push_db, other, push_db))
            )
    finally:
        await other.dispose()
    assert sum(counts) == 1
    assert len(service.sent) == 1


async def test_a_removed_device_gets_no_push(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    phone, _ = await subscribe(client, service, "phone", "laptop")
    await client.delete(f"/api/push/devices/{phone}")
    note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 1
    assert [endpoint for endpoint, _ in service.sent] == ["https://push.example/laptop"]


@pytest.mark.parametrize("status", [404, 410])
async def test_a_gone_endpoint_drops_its_device(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine, status: int
) -> None:
    service = PushService()
    await subscribe(client, service, "phone", "laptop")
    service.status["https://push.example/phone"] = status
    note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 1
    names = [d["name"] for d in (await client.get("/api/push")).json()["devices"]]
    assert names == ["laptop"]


async def test_a_failing_push_service_keeps_the_device_and_the_others_get_theirs(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone", "laptop", "tablet")
    service.status["https://push.example/phone"] = 500

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/laptop":
            raise httpx.ConnectTimeout("slow", request=request)
        return service.handle(request)

    note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        assert await tick(push_db, served, http, NOW) == 1
    assert "https://push.example/tablet" in [endpoint for endpoint, _ in service.sent]
    async with push_db.connect() as connection:
        assert await connection.scalar(select(func.count()).select_from(PushDevice)) == 3


async def test_done_fenced_and_archived_todos_send_nothing(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    note(served, "- [x] done ⏰ 2026-11-12 09:00\n\n```\n- [ ] fenced ⏰ 2026-11-12 09:00\n```\n")
    note(served, "- [ ] old ⏰ 2026-11-12 09:00\n", f"{served.archive_path}/Old.md")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 0
    assert service.sent == []
