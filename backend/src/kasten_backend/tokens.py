"""The bearer tokens an agent outside the box reaches the vault with.

A JSON file of records, `{name, digest, created}`, beside the vault and never
inside it. Inside would put a secret in jj history for good and sit it one
`search_notes` call away from any agent reading notes.

Only the digest is kept, so the file is worth nothing to whoever reads it and a
lost secret cannot be recovered, only replaced. SHA-256 rather than a slow hash:
the secret is 256 bits of `secrets` output, so the digest is not brute-forceable
and argon2 would defend nothing here while costing a hash on every request.

No `last_used` field. It would mean a file write per request to answer a question
`jj log` already answers by name.
"""

import asyncio
import hashlib
import json
import os
import secrets
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

PREFIX = "kasten_"
"""What every secret starts with, so a leaked one is greppable and scannable."""

_lock = asyncio.Lock()
"""Held across the read, the change and the write, so two mints cannot race.

Its own lock rather than the vault's: this file is not the vault, and a mint
waiting on a slow note save would be two unrelated things sharing a queue.
"""


class Token(BaseModel):
    """One token as anything but the mint may see it."""

    name: str
    created: datetime


class Minted(Token):
    """One token as its owner sees it, once."""

    secret: str


class _Record(Token):
    """One token as the file holds it."""

    digest: str


def digest(secret: str) -> str:
    """The SHA-256 hex of a secret, which is the only form of it that is stored."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _read(store: Path) -> list[_Record]:
    """Every record the file holds, or none at all.

    A missing file is an empty store, which is what makes a box with no tokens
    refuse every bearer rather than fail to start. There is no state in which
    that absence opens the gate: the caller matches a digest, and no digest
    matches nothing.
    """
    if not store.is_file():
        return []

    return [_Record.model_validate(record) for record in json.loads(store.read_text("utf-8"))]


def _write(store: Path, records: list[_Record]) -> None:
    """Replace the file with `records`, atomically and readable by its owner alone.

    A unique temp name from `mkstemp` in the same directory, which is `0600` by
    construction, then `os.replace` over the target. Not `vault.write_note`'s
    pattern: its temp name is a fixed `.{name}.tmp` that two mints would collide
    on, and `Path.write_text` takes its mode from the process umask.
    """
    store.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=store.parent, prefix=".tokens", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as output:
            json.dump([record.model_dump(mode="json") for record in records], output, indent=2)
        os.replace(temporary, store)  # noqa: PTH105  Path has no atomic replace of a str
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


async def mint(store: Path, name: str) -> Minted:
    """Add a token called `name` and hand back the only copy of its secret."""
    async with _lock:
        records = _read(store)
        if any(record.name == name for record in records):
            raise ValueError(f"There is already a token called {name}")

        secret = PREFIX + secrets.token_urlsafe(32)
        record = _Record(name=name, created=datetime.now(UTC), digest=digest(secret))
        _write(store, [*records, record])

    return Minted(name=record.name, created=record.created, secret=secret)


async def revoke(store: Path, name: str) -> bool:
    """Drop the token called `name`, and say whether there was one."""
    async with _lock:
        records = _read(store)
        kept = [record for record in records if record.name != name]
        if len(kept) == len(records):
            return False

        _write(store, kept)

    return True


async def listing(store: Path) -> list[Token]:
    """Every token the store holds, without the digests."""
    async with _lock:
        return [Token(name=record.name, created=record.created) for record in _read(store)]


async def verify(store: Path, secret: str) -> str | None:
    """The name behind `secret`, or None when the store does not hold it.

    `compare_digest` rather than `==`, so the comparison does not leak how much
    of a guess was right through how long it took to refuse.
    """
    presented = digest(secret)
    async with _lock:
        for record in _read(store):
            if secrets.compare_digest(record.digest, presented):
                return record.name

    return None
