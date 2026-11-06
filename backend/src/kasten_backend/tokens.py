"""The bearer tokens an agent outside the box reaches the vault with.

JSON files beside the vault, never inside it, where a secret would enter jj history. Only
the SHA-256 digest is kept, so a lost secret is replaced, not recovered. A revoked token
moves to `tokens-revoked.json`, so its requests are named as revoked.
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
from typing import TYPE_CHECKING, Literal, NamedTuple

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

if TYPE_CHECKING:
    from collections.abc import Sequence

logger = logging.getLogger(__name__)

PREFIX = "kasten_"
"""What every secret starts with, so a leaked one is greppable and scannable."""

Scope = Literal["agent", "reading"]

READING = "tokens-reading.json"
"""The file reading tokens live in, beside the store.

Not a `scope` field in `tokens.json`: an older backend ignores unknown fields, so on rollback
a reading token would open the whole vault. An older backend never reads this file.
"""

_lock = asyncio.Lock()
"""Held across the read, the change and the write, so two mints cannot race.

Its own lock, not the vault's: a mint waiting on a slow note save would share its queue.
"""


class Token(BaseModel):
    """One token as anything but the mint may see it."""

    # A validation error's text quotes the input, which in a token file holds
    # digests, and an error that escapes lands in the log with its traceback.
    model_config = ConfigDict(hide_input_in_errors=True)

    name: str
    created: datetime

    scope: Scope = "agent"
    """`reading` opens `GET /agent/reading` alone; `agent` opens every `/agent/` route."""


class Minted(Token):
    """One token as its owner sees it, once."""

    secret: str


class _Record(Token):
    """One token as the file holds it, its digest 64 lowercase hex characters.

    Non-ASCII text makes `compare_digest` raise, which turned every refusal into a 500 (#1226).
    So a bad record makes the file unreadable, which refuses with 401.
    """

    digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class _Revoked(_Record):
    """One revoked token as its file holds it: the record, and when it was revoked.

    Kept, so a request still carrying the secret is named as revoked, not as a stranger.
    """

    revoked: datetime


_HIDDEN = ConfigDict(hide_input_in_errors=True)
_RECORDS = TypeAdapter(list[_Record], config=_HIDDEN)
_REVOKED_LIST = TypeAdapter(list[_Revoked], config=_HIDDEN)

_UNREADABLE = (OSError, ValidationError)
"""Every way reading a token file fails: the file system's errors, and pydantic's.

`validate_json` reports bad JSON, bad UTF-8 and the wrong shape alike as `ValidationError`.
"""


REVOKED = "tokens-revoked.json"
"""The file revoked tokens move to, beside the store.

A file of its own, not a `revoked` field: an older backend ignores unknown fields in
`tokens.json`, so a field there would let a revoked token back in on rollback.
"""

REVOKED_KEPT = 50
"""How many revoked records the file keeps, in revoke order; older ones are dropped.

Dropping one cannot let its token back in: only the active files admit a bearer. A pruned
secret is refused as unknown, and the revoked file only names refusals. Without the cap,
every OAuth reconnect, which revokes then mints, would add a record for good.
"""


def digest(secret: str) -> str:
    """The SHA-256 hex of a secret, which is the only form of it that is stored."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _read(store: Path) -> list[_Record]:
    """Every record the store and its reading file hold, or none at all.

    A missing file is an empty store, so a box with no tokens refuses every bearer. Strict
    otherwise: returning nothing for a file that is there but unreadable would let `mint`
    and `revoke` write over every token it holds.
    """
    return _records(store, "agent") + _records(store.with_name(READING), "reading")


def _records(path: Path, scope: Scope) -> list[_Record]:
    if not path.exists():
        return []

    return [
        record.model_copy(update={"scope": scope})
        for record in _RECORDS.validate_json(path.read_bytes())
    ]


def _write_active(store: Path, records: list[_Record]) -> None:
    """Write each record to the file its scope names; the reading file only once it is needed."""
    _write(store, [record for record in records if record.scope == "agent"])
    reading = [record for record in records if record.scope == "reading"]
    if reading or store.with_name(READING).exists():
        _write(store.with_name(READING), reading)


def _read_revoked(path: Path) -> list[_Revoked] | None:
    """Every revoked record the file holds, or None when it is there and cannot be read.

    Lenient, unlike `_read`: a broken file names refusals only, so it must not refuse an
    active bearer or fail a revoke. `exists` rather than `is_file`, so a directory in its
    place counts as unreadable and `revoke` sets it aside.
    """
    if not path.exists():
        return []

    try:
        return _REVOKED_LIST.validate_json(path.read_bytes())
    except _UNREADABLE as error:
        logger.warning("Ignoring %s: it cannot be read (%s)", path, type(error).__name__)
        return None


def _write(target: Path, records: Sequence[BaseModel]) -> None:
    """Replace the file at `target` with `records`, atomically, readable by its owner alone.

    `mkstemp` gives a unique temp name, `0600` by construction. `vault.write_note`'s fixed
    temp name would collide between two mints, and `write_text` takes its mode from the umask.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=target.parent, prefix=".tokens", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as output:
            # The file a record sits in says its scope.
            rows = [record.model_dump(mode="json", exclude={"scope"}) for record in records]
            json.dump(rows, output, indent=2)
        os.replace(temporary, target)  # noqa: PTH105  Path has no atomic replace of a str
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


async def mint(store: Path, name: str, scope: Scope = "agent") -> Minted:
    """Add a token called `name` and hand back the only copy of its secret.

    A name a revoked token held is free again: only the active files are checked.
    """
    async with _lock:
        records = _read(store)
        if any(record.name == name for record in records):
            raise ValueError(f"There is already a token called {name}")

        secret = PREFIX + secrets.token_urlsafe(32)
        record = _Record(name=name, created=datetime.now(UTC), scope=scope, digest=digest(secret))
        _write_active(store, [*records, record])

    return Minted(name=record.name, created=record.created, scope=scope, secret=secret)


async def revoke(store: Path, name: str) -> bool:
    """Move the token called `name` to the revoked file, and say whether there was one.

    The active file is written first, so a crash between the writes leaves the token refused
    and unrecorded, which is safe. A broken revoked file is set aside as `.broken`; when even
    that fails, the token still leaves the active file.
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
        _write_active(store, [record for record in records if record.name != name])
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
        return [Token(**record.model_dump(exclude={"digest"})) for record in _read(store)]


class Holder(NamedTuple):
    """Who presented a secret: the token's name, whether it was revoked, and its scope."""

    name: str
    revoked: bool
    scope: Scope


async def identify(store: Path, secret: str) -> Holder | None:
    """Who holds `secret`; None when no file holds it.

    An unreadable `tokens.json` refuses every bearer, and an unreadable revoked file refuses a
    revoked secret as unknown, the same 401 either way. `compare_digest` rather than `==`, so
    timing does not show how much of a guess was right.
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
                return Holder(record.name, False, record.scope)

        revoked = _read_revoked(store.with_name(REVOKED))
        if revoked is None:
            return None

        for record in revoked:
            if secrets.compare_digest(record.digest, presented):
                return Holder(record.name, True, record.scope)

    return None


async def verify(store: Path, secret: str) -> str | None:
    """The name behind `secret` when it is an active token, or None otherwise."""
    found = await identify(store, secret)
    if found is None or found.revoked:
        return None

    return found.name
