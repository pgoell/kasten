"""Anki imports from an upload that run on past the request that started them.

Cloudflare drops a request it has not answered within 100 seconds, and a deck
of several hundred MB takes longer than that to unzip and merge. So the finish
waits a budget for its import and, past it, answers 202 and leaves the import
running here, where `GET /api/anki/imports/{upload}` reads how it ended.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from http import HTTPStatus
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from kasten_backend import uploads
from kasten_backend.files import RefusedError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

ANSWER_BUDGET_SECONDS = 20.0
"""How long a finish waits for its import before answering 202 and leaving it running.

Well under Cloudflare's 100, so a slow phone link has room; long enough that a
deck of any usual size still gets its counts or its refusal in the answer to
the finish itself.
"""


class AnkiImporting(BaseModel):
    """An import still running past the answer budget, to be asked after by its upload."""

    upload: str
    """The upload's id, which `GET /api/anki/imports/{upload}` answers for."""


@dataclass
class _Import:
    task: asyncio.Task[tuple[int, Any]]
    """Ends in the status and body the finish answers, never in a raise."""
    settings: object
    """What the import was asked to do beside the upload, Anki's schedule or not."""
    ended: float | None = None
    """When the task ended, by `time.monotonic`, so a stale outcome can be let go."""


_imports: dict[str, _Import] = {}
"""Every import from an upload this process ran, by upload id.

In memory, as the uploads are: one uvicorn worker, and a restart forgets both.
An outcome stays `uploads.UPLOAD_IDLE_SECONDS` after its end, so the poll can
read it and a second finish of a landed upload answers its counts again.
"""


def started(key: str, work: Callable[[], Awaitable[BaseModel]], settings: object) -> _Import:
    """The import of upload `key`: the one running or landed, else `work` started.

    Found and registered with no await between, so a second finish arriving
    while the first one runs joins it rather than importing the deck again.
    One refused or failed is started afresh, from the upload `taken` kept.

    `settings` tells two finishes apart beyond the upload: one asking for
    Anki's schedule cannot join one that runs without it and answer counts it
    never asked for. While that one runs it is refused; once it landed this
    starts afresh, and finds the upload gone.
    """
    now = time.monotonic()
    for old, ran in list(_imports.items()):
        if ran.ended is not None and now - ran.ended > uploads.UPLOAD_IDLE_SECONDS:
            del _imports[old]
    ran = _imports.get(key)
    if ran is not None and not ran.task.done() and ran.settings != settings:
        raise HTTPException(
            status_code=409,
            detail="That file is already importing with other settings. Wait for it to end.",
        )
    if (
        ran is not None
        and ran.settings == settings
        and (not ran.task.done() or ran.task.result()[0] < HTTPStatus.BAD_REQUEST)
    ):
        return ran
    ran = _Import(asyncio.create_task(_outcome(key, work)), settings)

    def ended(_task: asyncio.Task[tuple[int, Any]]) -> None:
        ran.ended = time.monotonic()

    ran.task.add_done_callback(ended)
    _imports[key] = ran
    return ran


async def _outcome(key: str, work: Callable[[], Awaitable[BaseModel]]) -> tuple[int, Any]:
    """Run `work` and end in its answer, the refusals turned into theirs.

    It outlives the request that started it, so a refusal cannot reach the
    handlers that would answer it: it becomes the status and body they would
    have written. Anything else becomes a 500 with its reason, logged.
    """
    try:
        done = await work()
    except HTTPException as error:
        return error.status_code, {"detail": error.detail}
    except RefusedError as error:
        return error.status, {"detail": str(error)}
    except Exception as error:
        # The one broad catch here, on purpose: a raise would end the task with
        # nobody to answer, and the poll would see a 500 with no reason. The
        # cancel at shutdown is a BaseException and passes.
        logger.exception("The Anki import of upload %s failed", key)
        return HTTPStatus.INTERNAL_SERVER_ERROR, {"detail": f"The import failed: {error}"}
    return HTTPStatus.CREATED, done.model_dump()


async def answer(key: str, ran: _Import) -> JSONResponse:
    """The import's answer if it ends within the budget, else a 202 naming the upload.

    `wait` rather than `wait_for`: a timeout there would cancel the import.
    """
    await asyncio.wait({ran.task}, timeout=ANSWER_BUDGET_SECONDS)
    if not ran.task.done():
        return _running(key)
    status, content = ran.task.result()
    return JSONResponse(status_code=status, content=content)


def outcome(key: str) -> JSONResponse:
    """What `answer` would say of upload `key` now, without waiting, a landed one as 200."""
    ran = _imports.get(key)
    if ran is None:
        raise HTTPException(
            status_code=404,
            detail="No such import. The backend may have restarted: import the file again.",
        )
    if not ran.task.done():
        return _running(key)
    status, content = ran.task.result()
    landed = status == HTTPStatus.CREATED
    return JSONResponse(status_code=HTTPStatus.OK if landed else status, content=content)


def _running(key: str) -> JSONResponse:
    return JSONResponse(status_code=202, content=AnkiImporting(upload=key).model_dump())


async def stop() -> None:
    """Cancel every import still running and wait while each takes back what it wrote.

    At shutdown, so a restart mid-import leaves the vault as the import found
    it: the Anki route's writes undo themselves on the way out, a cancel included.
    """
    running = [ran.task for ran in _imports.values() if not ran.task.done()]
    for task in running:
        task.cancel()
    await asyncio.gather(*running, return_exceptions=True)
    _imports.clear()
