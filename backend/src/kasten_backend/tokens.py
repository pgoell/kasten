"""The bearer tokens an agent outside the box reaches the vault with.

A JSON file of records, `{name, digest, created}`, beside the vault and never
inside it. Inside would put a secret in jj history for good and sit it one
`search_notes` call away from any agent reading notes.

Only the digest is kept, so the file is worth nothing to whoever reads it and a
lost secret cannot be recovered, only replaced. SHA-256 rather than a slow hash:
the secret is 256 bits of `secrets` output, so the digest is not brute-forceable
and argon2 would defend nothing here while costing a hash on every request.

A revoked token moves to `tokens-revoked.json` beside this file, so a request it
makes is named as revoked in the activity log and refused. That file keeps only
the last `REVOKED_KEPT` revokes. A secret pruned from it is refused as a stranger
would be, since only `tokens.json` admits a bearer and nothing moves a record
back. Last use lives in Postgres, in `token_action`: see `token_activity.py`.
"""

import asyncio
import hashlib
import json
import logging
import os
import secrets
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

logger = logging.getLogger(__name__)

PREFIX = "kasten_"
"""What every secret starts with, so a leaked one is greppable and scannable."""

_lock = asyncio.Lock()
"""Held across the read, the change and the write, so two mints cannot race.

Its own lock rather than the vault's: this file is not the vault, and a mint
waiting on a slow note save would be two unrelated things sharing a queue.
"""


class Token(BaseModel):
    """One token as anything but the mint may see it."""

    # A validation error's text quotes the input, which in a token file holds
    # digests, and an error that escapes lands in the log with its traceback.
    model_config = ConfigDict(hide_input_in_errors=True)

    name: str
    created: datetime


class Minted(Token):
    """One token as its owner sees it, once."""

    secret: str


class _Record(Token):
    """One token as the file holds it.

    The digest must be what `digest` writes, 64 lowercase hex characters. Any
    other text could never match, and non-ASCII text makes `compare_digest`
    raise `TypeError`, which turned every refusal into a 500 (#1226). So a
    record with anything else makes its file unreadable, which refuses with 401.
    """

    digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class _Revoked(_Record):
    """One revoked token as its file holds it: the record, and when it was revoked.

    Kept rather than dropped, so a request still carrying the secret is named as
    revoked in the activity log instead of looking like a stranger's.
    """

    revoked: datetime


_HIDDEN = ConfigDict(hide_input_in_errors=True)
_RECORDS = TypeAdapter(list[_Record], config=_HIDDEN)
_REVOKED_LIST = TypeAdapter(list[_Revoked], config=_HIDDEN)

_UNREADABLE = (OSError, ValidationError)
"""Every way reading a token file fails: the file system's errors, and pydantic's.

`validate_json` turns bad JSON, bad UTF-8 and the wrong shape alike into a
`ValidationError`, so these two cover every broken file.
"""


REVOKED = "tokens-revoked.json"
"""The file revoked tokens move to, beside the store.

A file of its own rather than a `revoked` field on each record: an older backend
reading `tokens.json` ignores unknown fields, so a field there would let a
revoked token back in on rollback.
"""

REVOKED_KEPT = 50
"""How many revoked records the file keeps, in revoke order; older ones are dropped.

Dropping one cannot let its token back in. Only `tokens.json` admits a bearer,
`revoke` takes the digest out of it before it writes the revoked file, and
nothing moves a record back. A pruned secret is unknown, so it is refused with
401. The revoked file only decides whether a refusal is named as revoked in the
activity log.

Without the cap, every OAuth reconnect, which revokes and then mints the same
name, would add a record for good.
"""


def digest(secret: str) -> str:
    """The SHA-256 hex of a secret, which is the only form of it that is stored."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _read(store: Path) -> list[_Record]:
    """Every record the file holds, or none at all.

    A missing file is an empty store, which is what makes a box with no tokens
    refuse every bearer rather than fail to start. There is no state in which
    that absence opens the gate: the caller matches a digest, and no digest
    matches nothing.

    Strict: a file that is there and cannot be read raises. Returning nothing
    instead would let `mint` and `revoke` write over every token the file holds.
    """
    if not store.exists():
        return []

    return _RECORDS.validate_json(store.read_bytes())


def _read_revoked(path: Path) -> list[_Revoked] | None:
    """Every revoked record the file holds, or None when the file is there and cannot be read.

    Lenient where `_read` is strict. The file only names refusals, so a broken
    one must not refuse an active bearer or fail a revoke. The log names the
    path and the kind of failure, never the error's text: pydantic's quotes the
    input, which holds digests.

    `exists` rather than `is_file`, so a directory in its place counts as
    unreadable and `revoke` sets it aside before writing anything.
    """
    if not path.exists():
        return []

    try:
        return _REVOKED_LIST.validate_json(path.read_bytes())
    except _UNREADABLE as error:
        logger.warning("Ignoring %s: it cannot be read (%s)", path, type(error).__name__)
        return None


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
        records = _read(store)
        if any(record.name == name for record in records):
            raise ValueError(f"There is already a token called {name}")

        secret = PREFIX + secrets.token_urlsafe(32)
        record = _Record(name=name, created=datetime.now(UTC), digest=digest(secret))
        _write(store, [*records, record])

    return Minted(name=record.name, created=record.created, secret=secret)


async def revoke(store: Path, name: str) -> bool:
    """Move the token called `name` to the revoked file, and say whether there was one.

    Both files are read before either is written, so a broken store raises with
    nothing changed. The active file is written first. A crash between the two
    writes then leaves the token refused and unrecorded, which is safe; the other
    order would leave it active.

    A broken revoked file is set aside as `.broken` and started again. Its
    records only name refusals, so losing them costs a log line, not access.
    When even the rename fails, the token still leaves the active file and the
    revoked file is left as it is: a revoke that cannot be recorded must still
    cut access, and writing over a directory would fail after the store write.
    """
    async with _lock:
        records = _read(store)
        gone = [record for record in records if record.name == name]
        if not gone:
            return False

        revoked_path = store.with_name(REVOKED)
        revoked = _read_revoked(revoked_path)
        if revoked is None:
            try:
                os.replace(revoked_path, revoked_path.with_name(REVOKED + ".broken"))  # noqa: PTH105  Path has no atomic replace of a str
                revoked = []
            except OSError as error:
                logger.warning(
                    "Not recording the revoke of %s: %s cannot be set aside (%s)",
                    name,
                    revoked_path,
                    type(error).__name__,
                )
        _write(store, [record for record in records if record.name != name])
        if revoked is None:
            return True

        moment = datetime.now(UTC)
        _write(
            revoked_path,
            [
                *revoked,
                *(_Revoked(**record.model_dump(), revoked=moment) for record in gone),
            ][-REVOKED_KEPT:],
        )

    return True


async def listing(store: Path) -> list[Token]:
    """Every token the store holds, without the digests."""
    async with _lock:
        return [Token(name=record.name, created=record.created) for record in _read(store)]


async def identify(store: Path, secret: str) -> tuple[str, bool] | None:
    """The name behind `secret`, and whether it was revoked; None when neither file holds it.

    A token file that cannot be read holds nothing. An unreadable `tokens.json`
    refuses every bearer, and an unreadable revoked file refuses a revoked
    secret as unknown: the same 401 either way, never a 500 and never a way in.

    `compare_digest` rather than `==`, so the comparison does not leak how much
    of a guess was right through how long it took to refuse.
    """
    presented = digest(secret)
    async with _lock:
        try:
            records = _read(store)
        except _UNREADABLE as error:
            logger.warning(
                "Refusing every bearer: %s cannot be read (%s)", store, type(error).__name__
            )
            return None

        for record in records:
            if secrets.compare_digest(record.digest, presented):
                return record.name, False

        revoked = _read_revoked(store.with_name(REVOKED))
        if revoked is None:
            return None

        for record in revoked:
            if secrets.compare_digest(record.digest, presented):
                return record.name, True

    return None


async def verify(store: Path, secret: str) -> str | None:
    """The name behind `secret` when it is an active token, or None otherwise."""
    found = await identify(store, secret)
    if found is None or found[1]:
        return None

    return found[0]
