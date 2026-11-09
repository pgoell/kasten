"""Push reminders: the RFC 8291 payload, the VAPID token, the devices routes and the sender.

The sender runs against the scratch database and a push service faked with `httpx.MockTransport`,
which decrypts each message with the device's own private key.
"""

import asyncio
import datetime as dt
import hashlib
import hmac
import json
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app
from kasten_backend.push import PushDevice, tick
from kasten_backend.push.due import reminder_of
from kasten_backend.push.loop import PUSH_LOCK
from kasten_backend.push.webpush import b64, encrypt, new_keys, private_key, unb64, vapid
from kasten_backend.search import Hit

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator
    from pathlib import Path

BERLIN = ZoneInfo("Europe/Berlin")
NOW = dt.datetime(2026, 11, 12, 9, 0, tzinfo=BERLIN)
KEY, PUBLIC = new_keys()


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
        "- [ ] in code `⏰ 2026-11-12 09:00`",
        "- [ ] bad hour ⏰ 2026-11-12 25:00",
        "- [ ] no such day ⏰ 2026-02-30 09:00",
        "- [ ] no time ⏰ 2026-11-12",
        "- not a todo ⏰ 2026-11-12 09:00",
    ],
)
def test_a_closed_coded_or_malformed_reminder_is_none(line: str) -> None:
    assert reminder_of(Hit("a.md", 1, line), BERLIN) is None


class PushService:
    """A push service that keeps what it is sent, decrypted, and answers each endpoint's status."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict]] = []
        self.status: dict[str, int] = {}
        self.keys: dict[str, ec.EllipticCurvePrivateKey] = {}
        self.auth: dict[str, bytes] = {}

    def device(self, name: str) -> dict:
        key = ec.generate_private_key(ec.SECP256R1())
        endpoint = f"https://push.example/{name}"
        self.keys[endpoint] = key
        self.auth[endpoint] = hashlib.sha256(name.encode()).digest()[:16]
        public = key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        return {
            "endpoint": endpoint,
            "keys": {"p256dh": b64(public), "auth": b64(self.auth[endpoint])},
            "name": name,
        }

    def _open(self, endpoint: str, body: bytes) -> dict:
        salt, as_public, cipher = body[:16], body[21:86], body[86:]
        ua = self.keys[endpoint]
        ua_public = ua.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
        secret = ua.exchange(ec.ECDH(), peer)

        def mac(k: bytes, d: bytes) -> bytes:
            return hmac.new(k, d, hashlib.sha256).digest()

        info = b"WebPush: info\x00" + ua_public + as_public + b"\x01"
        prk = mac(salt, mac(mac(self.auth[endpoint], secret), info))
        cek = mac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
        nonce = mac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
        plain = AESGCM(cek).decrypt(nonce, cipher, None)
        assert plain.endswith(b"\x02")
        return json.loads(plain[:-1])

    def handle(self, request: httpx.Request) -> httpx.Response:
        endpoint = str(request.url)
        assert request.headers["content-encoding"] == "aes128gcm"
        assert request.headers["authorization"].startswith("vapid t=")
        self.sent.append((endpoint, self._open(endpoint, request.content)))
        return httpx.Response(self.status.get(endpoint, 201))

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handle))


@pytest.fixture
async def push_db(scratch_database: str) -> AsyncIterator[AsyncEngine]:
    """The scratch database with both push tables empty."""
    engine = create_async_engine(scratch_database, poolclass=NullPool)
    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM push_sent"))
        await connection.execute(text("DELETE FROM push_devices"))
    yield engine
    await engine.dispose()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    root = tmp_path / "vault"
    root.mkdir()
    return Settings(vault_path=root, push_private_key=KEY, timezone="Europe/Berlin")


@pytest.fixture
def served(settings: Settings, push_db: AsyncEngine, activity: AsyncEngine) -> Iterator[Settings]:
    """The app on the scratch database, with push set up."""
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings)


async def _subscribe(client: httpx.AsyncClient, service: PushService, *names: str) -> list[int]:
    ids = []
    for name in names:
        answer = await client.post("/api/push/devices", json=service.device(name))
        assert answer.status_code == 201
        ids.append(answer.json()["id"])
    return ids


def _note(settings: Settings, body: str, path: str = "Today.md") -> None:
    target = settings.vault_path / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body, encoding="utf-8")


async def test_devices_are_listed_and_one_endpoint_is_one_device(
    client: httpx.AsyncClient, served: Settings
) -> None:
    service = PushService()
    phone = service.device("phone")
    first = (await client.post("/api/push/devices", json=phone)).json()
    again = (await client.post("/api/push/devices", json={**phone, "name": "Pixel"})).json()
    await _subscribe(client, service, "laptop")
    listed = (await client.get("/api/push")).json()
    assert listed["public_key"] == PUBLIC
    assert first["id"] == again["id"]
    assert [d["name"] for d in listed["devices"]] == ["Pixel", "laptop"]
    assert "p256dh" not in listed["devices"][0]


async def test_a_device_is_removed(client: httpx.AsyncClient, served: Settings) -> None:
    ids = await _subscribe(client, PushService(), "phone", "laptop")
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
    finally:
        app.dependency_overrides.pop(get_settings)
    async with PushService().client() as http:
        assert await tick(push_db, bare, http, NOW) == 0


async def test_a_reminder_due_now_goes_to_every_device_with_its_note(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await _subscribe(client, service, "phone", "laptop")
    _note(served, "# Today\n\n- [ ] call the dentist ⏰ 2026-11-12 09:00\n", "01 Periodic/Today.md")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 1
    assert sorted(endpoint for endpoint, _ in service.sent) == [
        "https://push.example/laptop",
        "https://push.example/phone",
    ]
    message = service.sent[0][1]
    assert message["body"] == "call the dentist"
    assert (message["path"], message["line"]) == ("01 Periodic/Today.md", 3)


async def test_a_reminder_not_yet_due_waits(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await _subscribe(client, service, "phone")
    _note(served, "- [ ] later ⏰ 2026-11-12 09:01\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 0
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=1)) == 1


@pytest.mark.parametrize(("late", "sent"), [(59, 1), (60, 0), (61, 0), (180, 0)])
async def test_a_missed_reminder_goes_late_under_an_hour_and_is_dropped_after(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine, late: int, sent: int
) -> None:
    service = PushService()
    await _subscribe(client, service, "phone")
    _note(served, "- [ ] missed ⏰ 2026-11-12 09:00\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=late)) == sent
        # A dropped one stays dropped: it never becomes due again.
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=late + 1)) == 0
    assert len(service.sent) == sent


async def test_a_restart_after_a_send_does_not_send_again(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine, scratch_database: str
) -> None:
    service = PushService()
    await _subscribe(client, service, "phone")
    _note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 1
    # A new process: its own engine and client, nothing kept in memory; a line added above.
    _note(served, "# Today\n\n- [ ] once ⏰ 2026-11-12 09:00\n")
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
    await _subscribe(client, service, "phone")
    _note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
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
    phone, _ = await _subscribe(client, service, "phone", "laptop")
    await client.delete(f"/api/push/devices/{phone}")
    _note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 1
    assert [endpoint for endpoint, _ in service.sent] == ["https://push.example/laptop"]


@pytest.mark.parametrize("status", [404, 410])
async def test_a_gone_endpoint_drops_its_device(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine, status: int
) -> None:
    service = PushService()
    await _subscribe(client, service, "phone", "laptop")
    service.status["https://push.example/phone"] = status
    _note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 1
    names = [d["name"] for d in (await client.get("/api/push")).json()["devices"]]
    assert names == ["laptop"]


async def test_a_failing_push_service_keeps_the_device_and_the_others_get_theirs(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await _subscribe(client, service, "phone", "laptop", "tablet")
    service.status["https://push.example/phone"] = 500

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/laptop":
            raise httpx.ConnectTimeout("slow", request=request)
        return service.handle(request)

    _note(served, "- [ ] once ⏰ 2026-11-12 09:00\n")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
        assert await tick(push_db, served, http, NOW) == 1
    assert "https://push.example/tablet" in [endpoint for endpoint, _ in service.sent]
    async with push_db.connect() as connection:
        assert await connection.scalar(select(func.count()).select_from(PushDevice)) == 3


async def test_done_fenced_and_archived_todos_send_nothing(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await _subscribe(client, service, "phone")
    _note(served, "- [x] done ⏰ 2026-11-12 09:00\n\n```\n- [ ] fenced ⏰ 2026-11-12 09:00\n```\n")
    _note(served, "- [ ] old ⏰ 2026-11-12 09:00\n", f"{served.archive_path}/Old.md")
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW) == 0
    assert service.sent == []
