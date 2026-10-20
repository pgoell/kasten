"""A file sent in pieces, joined on disk until the route that uses it finishes it.

Cloudflare refuses a request body over 100MB, and drops a request it has not
answered within 100 seconds, so the browser cuts a big file and sends it a
piece at a time. `POST /api/anki?upload=` and `POST /api/assets/{path}?upload=`
then read the joined file in place of a body.

What has arrived is kept in memory, not in a table: the backend runs one
uvicorn worker (the Dockerfile's `CMD` names no `--workers`), so every piece
reaches the process that holds its upload. A restart forgets them all, and
`wipe` at startup clears the folder to match.
"""

import asyncio
import secrets
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from kasten_backend.files import UPLOAD_LIMIT_BYTES, RefusedError, too_big

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

UPLOAD_IDLE_SECONDS = 3600
"""How long an upload may go without a piece before the next one started sweeps it.

Read off the temp's mtime, which the last piece written sets, so a slow upload
that is still sending survives however long it takes in all.
"""

READ_BYTES = 1024 * 1024
"""How much of a joined file `read` hands `store` at a time."""


@dataclass
class _Upload:
    path: Path
    size: int
    """What `POST /api/uploads` declared, and what the pieces must add up to."""
    starts: list[int] = field(default_factory=list)
    """Where each piece received so far begins in the temp."""
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    """Held for a piece and for the finish, so two requests cannot interleave bytes."""


_uploads: dict[str, _Upload] = {}


def wipe(folder: Path) -> None:
    """Forget every upload and empty `folder`, which only uploads write into."""
    _uploads.clear()
    folder.mkdir(parents=True, exist_ok=True)
    for entry in folder.iterdir():
        entry.unlink()


def _drop(key: str) -> None:
    upload = _uploads.pop(key)
    upload.path.unlink(missing_ok=True)


def start(folder: Path, size: int) -> str:
    """Open an empty temp for a file of `size` bytes, and answer with its id."""
    if size < 1:
        raise RefusedError(400, "An upload needs a size of at least one byte")
    if size > UPLOAD_LIMIT_BYTES:
        raise RefusedError(413, too_big(UPLOAD_LIMIT_BYTES))

    idle = time.time() - UPLOAD_IDLE_SECONDS
    for key, upload in list(_uploads.items()):
        # One mid-piece is live whatever its mtime says.
        if not upload.lock.locked() and upload.path.stat().st_mtime < idle:
            _drop(key)

    key = secrets.token_hex(16)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / key
    path.touch(exist_ok=False)
    _uploads[key] = _Upload(path, size)
    return key


def _find(key: str) -> _Upload:
    # Looked up before anything is built from `key`, so an id is never a path.
    upload = _uploads.get(key)
    if upload is None:
        raise RefusedError(404, "No such upload")
    return upload


async def write(key: str, n: int, chunks: AsyncIterator[bytes]) -> None:
    """Write piece `n` of the upload `key`: the next one, or the last one again.

    The last one again is a resend from a client whose answer got lost, and it
    replaces that piece. A piece that runs past the declared size, or whose
    body breaks off, leaves the temp cut back to where it began, so the same
    `n` sent again lands whole.
    """
    upload = _find(key)
    async with upload.lock:
        # A finish may have taken it while this waited for the lock.
        if _uploads.get(key) is not upload:
            raise RefusedError(404, "No such upload")
        received = len(upload.starts)
        if n == received:
            begin = upload.path.stat().st_size
        elif n == received - 1:
            begin = upload.starts.pop()
        else:
            raise RefusedError(409, f"Piece {n} is out of turn: the next is piece {received}")

        landed = False
        with upload.path.open("r+b") as output:
            try:
                output.truncate(begin)
                output.seek(begin)
                end = begin
                async for chunk in chunks:
                    end += len(chunk)
                    if end > upload.size:
                        raise RefusedError(413, "That piece runs past the size the upload declared")
                    output.write(chunk)
                landed = True
            finally:
                if not landed:
                    output.truncate(begin)
        upload.starts.append(begin)


@asynccontextmanager
async def finished(key: str) -> AsyncIterator[Path]:
    """The joined file of upload `key`, which is gone once the block ends however it ends."""
    upload = _find(key)
    async with upload.lock:
        if _uploads.get(key) is not upload:
            raise RefusedError(404, "No such upload")
        try:
            if upload.path.stat().st_size != upload.size:
                raise RefusedError(409, "That upload is not finished")
            yield upload.path
        finally:
            _drop(key)


async def read(path: Path) -> AsyncIterator[bytes]:
    """`path` a slice at a time, for `store`, which takes a stream and not a file.

    Through `store` rather than a link or a rename into the vault: the temp
    sits on another filesystem in the container, where both fail with `EXDEV`,
    and `store` holds the never-overwrite rule, the content check and the cap.
    """
    with path.open("rb") as source:
        while chunk := source.read(READ_BYTES):
            yield chunk
