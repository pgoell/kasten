"""Anki imports that run on past the request which started them.

Cloudflare drops a request unanswered after 100 seconds, and a big deck takes longer.
So the finish waits a budget, then answers 202 and leaves the import running.
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
"""How long a finish waits for its import before answering 202, under Cloudflare's 100 s."""


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
"""Every import this process ran, by upload id.

In memory, one worker, so a restart forgets them. An outcome stays
`uploads.UPLOAD_IDLE_SECONDS` after its end, so the poll can read it.
"""


def started(key: str, work: Callable[[], Awaitable[BaseModel]], settings: object) -> _Import:
    """The import of upload `key`: the one running or landed, else `work` started.

    Registered with no await between finding and starting, so a second finish joins the
    first instead of importing again. `settings` is part of the match: a finish asking
    for Anki's schedule never joins one that runs without it.
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
    landed = ran is not None and ran.task.done() and ran.task.result()[0] < HTTPStatus.BAD_REQUEST
    if ran is not None and ran.settings != settings and landed:
        # Left in place, so a poll of the landed import still reads its counts.
        raise HTTPException(status_code=404, detail="No such upload")
    if ran is not None and ran.settings == settings and (not ran.task.done() or landed):
        return ran
    ran = _Import(asyncio.create_task(_outcome(key, work)), settings)

    def ended(_task: asyncio.Task[tuple[int, Any]]) -> None:
        ran.ended = time.monotonic()

    ran.task.add_done_callback(ended)
    _imports[key] = ran
    return ran


async def _outcome(key: str, work: Callable[[], Awaitable[BaseModel]]) -> tuple[int, Any]:
    """Run `work` and return its answer, with its refusals turned into status and body.

    It outlives the request, so a refusal cannot reach a handler to answer it.
    Anything else is a logged 500.
    """
    try:
        done = await work()
    except HTTPException as error:
        return error.status_code, {"detail": error.detail}
    except RefusedError as error:
        return error.status, {"detail": str(error)}
    except Exception as error:
        # The one broad catch, on purpose: a raise would end the task with nobody to answer.
        # The cancel at shutdown is a BaseException and passes.
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
    """Cancel every import still running at shutdown, each taking back what it wrote.

    So a restart mid-import leaves the vault as the import found it.
    """
    running = [ran.task for ran in _imports.values() if not ran.task.done()]
    for task in running:
        task.cancel()
    await asyncio.gather(*running, return_exceptions=True)
    _imports.clear()
