"""The push tests' fakes: a push service that decrypts what it gets, and the app on scratch.

`httpx.MockTransport` opens each message with the device's own private key.
"""

import hashlib
import hmac
import json
from typing import TYPE_CHECKING

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app
from kasten_backend.push.webpush import b64, new_keys

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator
    from pathlib import Path

KEY, PUBLIC = new_keys()


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
    """The scratch database with every push table empty."""
    engine = create_async_engine(scratch_database, poolclass=NullPool)
    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM push_sent"))
        await connection.execute(text("DELETE FROM push_devices"))
        await connection.execute(text("DELETE FROM push_timers"))
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


async def subscribe(client: httpx.AsyncClient, service: PushService, *names: str) -> list[int]:
    """Subscribe devices by name through the route; their ids, in order."""
    ids = []
    for name in names:
        answer = await client.post("/api/push/devices", json=service.device(name))
        assert answer.status_code == 201
        ids.append(answer.json()["id"])
    return ids


def note(settings: Settings, body: str, path: str = "Today.md") -> None:
    """Write a note into the vault the sender scans."""
    target = settings.vault_path / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body, encoding="utf-8")
