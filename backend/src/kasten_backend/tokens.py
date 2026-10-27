"""The bearer tokens an agent outside the box reaches the vault with.

A JSON file of records, `{name, digest, created}`, beside the vault and never
inside it. Inside would put a secret in jj history for good and sit it one
`search_notes` call away from any agent reading notes.

Only the digest is kept, so the file is worth nothing to whoever reads it and a
lost secret cannot be recovered, only replaced. SHA-256 rather than a slow hash:
the secret is 256 bits of `secrets` output, so the digest is not brute-forceable
and argon2 would defend nothing here while costing a hash on every request.

A revoked token moves to `tokens-revoked.json` beside this file, so a request it
makes is named as revoked in the activity log and refused. Last use lives in
Postgres, in `token_action`: see `token_activity.py`.
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


class _Revoked(_Record):
    """One revoked token as its file holds it: the record, and when it was revoked.

    Kept rather than dropped, so a request still carrying the secret is named as
    revoked in the activity log instead of looking like a stranger's.
    """

    revoked: datetime


REVOKED = "tokens-revoked.json"
"""The file revoked tokens move to, beside the store.

A file of its own rather than a `revoked` field on each record: an older backend
reading `tokens.json` ignores unknown fields, so a field there would let a
revoked token back in on rollback.
"""


def digest(secret: str) -> str:
    """The SHA-256 hex of a secret, which is the only form of it that is stored."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _read[R: _Record](store: Path, model: type[R]) -> list[R]:
    """Every record the file holds, or none at all.

    A missing file is an empty store, which is what makes a box with no tokens
    refuse every bearer rather than fail to start. There is no state in which
    that absence opens the gate: the caller matches a digest, and no digest
    matches nothing.
    """
    if not store.is_file():
        return []

    return [model.model_validate(record) for record in json.loads(store.read_text("utf-8"))]


def _write(target: Path, records: list[BaseModel]) -> None:
    """Replace the file at `target` with `records`, atomically and readable by its owner alone.

    A unique temp name from `mkstemp` in the same directory, which is `0600` by
    construction, then `os.replace` over the target. Not `vault.write_note`'s
    pattern: its temp name is a fixed `.{name}.tmp` that two mints would collide
    on, and `Path.write_text` takes its mode from the process umask.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=target.parent, prefix=".tokens", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as output:
            json.dump([record.model_dump(mode="json") for record in records], output, indent=2)
        os.replace(temporary, target)  # noqa: PTH105  Path has no atomic replace of a str
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


async def mint(store: Path, name: str) -> Minted:
    """Add a token called `name` and hand back the only copy of its secret.

    A name a revoked token held is free again: only the active file is checked.
    """
    async with _lock:
        records = _read(store, _Record)
        if any(record.name == name for record in records):
            raise ValueError(f"There is already a token called {name}")

        secret = PREFIX + secrets.token_urlsafe(32)
        record = _Record(name=name, created=datetime.now(UTC), digest=digest(secret))
        _write(store, [*records, record])

    return Minted(name=record.name, created=record.created, secret=secret)


async def revoke(store: Path, name: str) -> bool:
    """Move the token called `name` to the revoked file, and say whether there was one.

    The active file is written first. A crash between the two writes then leaves
    the token refused and unrecorded, which is safe; the other order would leave
    it active.
    """
    async with _lock:
        records = _read(store, _Record)
        gone = [record for record in records if record.name == name]
        if not gone:
            return False

        _write(store, [record for record in records if record.name != name])
        moment = datetime.now(UTC)
        revoked = _read(store.with_name(REVOKED), _Revoked)
        _write(
            store.with_name(REVOKED),
            [
                *revoked,
                *(_Revoked(**record.model_dump(), revoked=moment) for record in gone),
            ],
        )

    return True


async def listing(store: Path) -> list[Token]:
    """Every token the store holds, without the digests."""
    async with _lock:
        return [Token(name=record.name, created=record.created) for record in _read(store, _Record)]


async def identify(store: Path, secret: str) -> tuple[str, bool] | None:
    """The name behind `secret`, and whether it was revoked; None when neither file holds it.

    `compare_digest` rather than `==`, so the comparison does not leak how much
    of a guess was right through how long it took to refuse.
    """
    presented = digest(secret)
    async with _lock:
        for record in _read(store, _Record):
            if secrets.compare_digest(record.digest, presented):
                return record.name, False

        for record in _read(store.with_name(REVOKED), _Revoked):
            if secrets.compare_digest(record.digest, presented):
                return record.name, True

    return None


async def verify(store: Path, secret: str) -> str | None:
    """The name behind `secret` when it is an active token, or None otherwise."""
    found = await identify(store, secret)
    if found is None or found[1]:
        return None

    return found[0]
