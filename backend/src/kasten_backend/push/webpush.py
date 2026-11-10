"""Web push by hand: the payload encrypted as RFC 8291 says, signed with a VAPID key (RFC 8292).

`cryptography` does the maths, so no push library joins the lock.
"""

import base64
import hashlib
import hmac
import json
import os
import struct
import time
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

if TYPE_CHECKING:
    import httpx

RECORD_SIZE = 4096
TTL_SECONDS = 3600
"""How long the push service keeps a message for a phone that is off: past that it is stale."""
SUBJECT = "https://github.com/pgoell/kasten"
"""The contact the VAPID token names; Apple refuses a token with none."""


def b64(data: bytes) -> str:
    """Base64url without padding, as every web push key and token is written."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    """The bytes of an unpadded base64url string."""
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _hmac(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha256).digest()


def _raw(public: ec.EllipticCurvePublicKey) -> bytes:
    return public.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )


def private_key(text: str) -> ec.EllipticCurvePrivateKey:
    """A VAPID private key as `web-push generate-vapid-keys` prints it: 32 bytes, base64url."""
    return ec.derive_private_key(int.from_bytes(unb64(text), "big"), ec.SECP256R1())


def public_key(text: str) -> str:
    """The application server key a browser subscribes with, from the private key."""
    return b64(_raw(private_key(text).public_key()))


def new_keys() -> tuple[str, str]:
    """A fresh VAPID pair, private and public, both base64url."""
    key = ec.generate_private_key(ec.SECP256R1())
    return b64(key.private_numbers().private_value.to_bytes(32, "big")), b64(_raw(key.public_key()))


def encrypt(
    plaintext: bytes,
    p256dh: str,
    auth: str,
    salt: bytes | None = None,
    server: ec.EllipticCurvePrivateKey | None = None,
) -> bytes:
    """One aes128gcm record for the subscription's keys; `salt` and `server` fixed only by tests."""
    salt = salt or os.urandom(16)
    server = server or ec.generate_private_key(ec.SECP256R1())
    ua_public = unb64(p256dh)
    as_public = _raw(server.public_key())
    peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    secret = server.exchange(ec.ECDH(), peer)
    ikm = _hmac(_hmac(unb64(auth), secret), b"WebPush: info\x00" + ua_public + as_public + b"\x01")
    prk = _hmac(salt, ikm)
    cek = _hmac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
    nonce = _hmac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
    body = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    return salt + struct.pack(">IB", RECORD_SIZE, len(as_public)) + as_public + body


def vapid(endpoint: str, key: str, now: float | None = None) -> str:
    """The `Authorization` header for `endpoint`: an ES256 token for its origin, and the key."""
    parts = urlsplit(endpoint)
    claims = {
        "aud": f"{parts.scheme}://{parts.netloc}",
        "exp": int(now or time.time()) + 12 * 3600,
        "sub": SUBJECT,
    }
    head = b64(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    signing = f"{head}.{b64(json.dumps(claims).encode())}"
    r, s = decode_dss_signature(private_key(key).sign(signing.encode(), ec.ECDSA(hashes.SHA256())))
    token = f"{signing}.{b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
    return f"vapid t={token}, k={public_key(key)}"


async def send(  # noqa: PLR0913  a subscription is three fields, and each goes its own way
    client: httpx.AsyncClient, endpoint: str, p256dh: str, auth: str, *, message: dict, key: str
) -> httpx.Response:
    """Post `message` to the push service; its answer, 404 or 410 meaning the device is gone."""
    return await client.post(
        endpoint,
        content=encrypt(json.dumps(message).encode(), p256dh, auth),
        headers={
            "Authorization": vapid(endpoint, key),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(TTL_SECONDS),
            "Urgency": "high",
        },
    )
