"""The `/agent/` routes and the bearer check in front of every one of them.

The check hangs off the router's constructor, so every route under it is gated by
construction. This prefix has no `oauth2_auth` in Caddy: this check is the whole trust boundary.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.requests import ClientDisconnect

from kasten_backend import files, page_store, posts, skills, vcs
from kasten_backend.agent import capabilities as agent
from kasten_backend.agent.finance.route import router as finance_router
from kasten_backend.books.library import fraction, named_book, note_text
from kasten_backend.config import Settings, get_settings
from kasten_backend.frontmatter import field
from kasten_backend.graph import MOST_DEPTH, Graph, GraphError
from kasten_backend.search import notes_holding
from kasten_backend.tokens import Holder, Scope, identify
from kasten_backend.tokens import activity as token_activity
from kasten_backend.vault import HTML_SUFFIX, list_markdown_files

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

BEARER = "Bearer "
"""The one scheme this accepts. Anything else is refused before the store is read."""

REFUSED = "That is not a token this vault knows"
"""One sentence for every refusal, so the answer says nothing about which it was."""


async def _admit(request: Request, settings: Settings, scopes: set[Scope]) -> Holder:
    """The holder of the bearer, refused unless its token is active and of one of `scopes`."""
    header = request.headers.get("Authorization", "")
    if not header.startswith(BEARER):
        raise HTTPException(status_code=401, detail=REFUSED)

    found = await identify(settings.tokens_path, header.removeprefix(BEARER))
    if found is None:
        raise HTTPException(status_code=401, detail=REFUSED)

    if found.revoked:
        token_activity.named(found.name, revoked=True)
        raise HTTPException(status_code=401, detail=REFUSED)

    token_activity.named(found.name, note=request.path_params.get("path"))
    if found.scope not in scopes:
        raise HTTPException(status_code=401, detail=REFUSED)

    return found


async def require_token(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> AsyncIterator[str]:
    """Refuse anyone without a full agent token in the store, and name the one who has it.

    A yield, so `vcs.writer` is reset after each request. Without the reset, a browser
    save after an agent save would be recorded as an agent write.
    """
    name = (await _admit(request, settings, {"agent"})).name
    held = vcs.writer.set(name)
    try:
        yield name
    finally:
        vcs.writer.reset(held)


async def require_reader(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> str:
    """Refuse anyone without a reading or a full agent token. The routes it guards write nothing."""
    return (await _admit(request, settings, {"agent", "reading"})).name


router = APIRouter(prefix="/agent", dependencies=[Depends(require_token)], tags=["agent"])

reading_router = APIRouter(prefix="/agent", dependencies=[Depends(require_reader)], tags=["agent"])
"""The routes a reading token opens, on a router of their own so their gate is by construction.

Each serves only what pgoell.com shows anyway: the book being read and the published posts.
"""


class Reading(BaseModel):
    """The book being read, for the Reading pane on pgoell.com, and nothing else of its note."""

    title: str
    author: str | None
    progress: float | None
    read_at: str


@reading_router.get(
    "/reading",
    response_model=Reading,
    responses={204: {"description": "No note qualifies"}},
)
async def reading(settings: Annotated[Settings, Depends(get_settings)]) -> Reading | Response:
    """The book being read, or 204 when no note qualifies."""
    found = await current_book(settings)
    return Response(status_code=204) if found is None else found


async def current_book(settings: Settings) -> Reading | None:
    """The current book; None when the named one has no `read_at:` or no note qualifies."""
    root = settings.vault_path
    named = named_book(settings, list_markdown_files(root))
    if named is not None:
        return _reading(root, named)

    books: list[Reading] = []
    for path in await notes_holding(root, "reading:"):
        book = _reading(root, path)
        if book is not None:
            books.append(book)
    if not books:
        return None
    return max(books, key=lambda book: _moment(book.read_at) or datetime.min)


def _reading(root: Path, path: str) -> Reading | None:
    """What the pane shows of the note at `path`, or None without `reading:` and a `read_at:`."""
    text = note_text(root, path)
    read_at = field(text, "read_at")
    if not field(text, "reading") or not read_at or _moment(read_at) is None:
        return None
    author = field(text, "author")
    return Reading(
        title=path.rsplit("/", 1)[-1].removesuffix(".md"),
        author=author or None,
        progress=fraction(field(text, "progress")),
        read_at=read_at,
    )


@reading_router.get("/posts")
async def published_posts(
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[posts.PostMeta]:
    """Every note marked `publish: true`, newest first, without its body."""
    return await posts.posts(settings)


@reading_router.get("/posts/{slug}")
async def published_post(
    slug: str, settings: Annotated[Settings, Depends(get_settings)], lang: str | None = None
) -> posts.Post:
    """One published post by its slug, in `lang` when there is one in it."""
    found = await posts.post(settings, slug, lang)
    if found is None:
        raise HTTPException(status_code=404, detail="No such post")
    return found


def _moment(text: str) -> datetime | None:
    """`text` as an aware time, a time without an offset taken as UTC; None when it is no time."""
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


@router.get("/notes/{path:path}")
async def read_note(
    path: str, settings: Annotated[Settings, Depends(get_settings)]
) -> agent.NoteRead:
    """Read one note, with the digest a conditional write presents back."""
    found = await agent.read_note(settings, path)
    if found is None:
        raise HTTPException(status_code=404, detail="No such note")

    return found


@router.get("/notes")
async def list_notes(
    settings: Annotated[Settings, Depends(get_settings)], folder: str = ""
) -> list[str]:
    """List every note in the vault, or every note in one folder of it."""
    return await agent.list_notes(settings, folder)


# Unset rather than null, so a note's hit answers as it did before files were searched.
@router.get("/search", response_model_exclude_unset=True)
async def search_notes(
    q: str, settings: Annotated[Settings, Depends(get_settings)], archive: bool = False
) -> list[agent.Hit]:
    """Find every line in the vault holding `q`, ignoring case, in notes and pdf, epub and html."""
    return await agent.search_notes(settings, q, archive)


@router.get("/search/meaning")
async def search_meaning(
    settings: Annotated[Settings, Depends(get_settings)],
    q: str = "",
    like: str | None = None,
    archive: bool = False,
) -> agent.Meaning:
    """The notes best matching `q` by words and meaning, or with `like`, the notes like that one."""
    return await agent.search_meaning(settings, q, like, archive)


@router.get("/skills")
async def list_skills(settings: Annotated[Settings, Depends(get_settings)]) -> list[skills.Skill]:
    """List the Claude Code skills in the skills folder, with their files."""
    return await skills.list_skills(settings)


@router.get("/skills/{path:path}")
async def read_skill(
    path: str, settings: Annotated[Settings, Depends(get_settings)]
) -> skills.SkillRead:
    """Read one skill file, relative to the skills folder."""
    found = await skills.read_skill(settings, path)
    if found is None:
        raise HTTPException(status_code=404, detail="No such skill file")

    return found


@router.get("/graph")
async def graph(
    settings: Annotated[Settings, Depends(get_settings)],
    q: str = "",
    around: str | None = None,
    depth: Annotated[int, Query(ge=0, le=MOST_DEPTH)] = 1,
    archive: bool = False,
) -> Graph:
    """The notes as a graph, narrowed by a filter or asked a pattern."""
    try:
        return await agent.graph(settings, q, around, depth, archive)
    except GraphError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/openapi.json")
async def schema(request: Request) -> dict[str, Any]:
    """This prefix, described as OpenAPI, for a caller with no MCP client.

    An agent over MCP discovers the eleven capabilities from `tools/list`. One
    holding a token and a curl has nothing to read, because `/openapi.json` at
    the root is behind oauth2-proxy and describes the browser's API rather than
    this one.

    Built from this router's own routes rather than by filtering the whole
    application's schema, so it names the ten and pulls in only the models they
    reference. A token holder cannot reach anything under `/api/`, and handing
    one the map of those routes would give it away for nothing.
    """
    return get_openapi(
        title=f"{request.app.title} agent API",
        version=request.app.version,
        routes=[*router.routes, *reading_router.routes],
    )


# Included here rather than in `main.py`, so the finance reads sit behind this
# router's token check and in the schema above without either knowing of them.
router.include_router(finance_router)


@router.put("/notes/{path:path}")
async def save_note(
    path: str, edit: agent.Save, settings: Annotated[Settings, Depends(get_settings)]
) -> agent.NoteRead:
    """Write one note, creating it when `sha` is absent and the note is."""
    return _written(await agent.save_note(settings, path, edit.content, edit.sha))


@router.post("/notes/{path:path}/append")
async def append_note(
    path: str, edit: agent.Append, settings: Annotated[Settings, Depends(get_settings)]
) -> agent.NoteRead:
    """Add a line to the end of one note, creating it when there is none."""
    return _written(await agent.append_note(settings, path, edit.text, edit.sha))


@router.post("/dump")
async def dump(
    capture: agent.Dump, settings: Annotated[Settings, Depends(get_settings)]
) -> agent.NoteRead:
    """Add a paragraph to the `## Dump` of the daily note for `date`, making either."""
    return _written(await agent.dump(settings, capture.text, capture.date))


class Fetch(BaseModel):
    """Where to read a file from, for a caller holding a link rather than the bytes."""

    url: str


class Filed(BaseModel):
    """The vault-relative path a file landed at."""

    path: str


# Above the upload, whose `{path:path}` would otherwise take `a.pdf/fetch` whole
# and refuse it as a path the vault will not take.
@router.post("/files/{path:path}/fetch", status_code=201)
async def fetch_file(
    path: str, source: Fetch, settings: Annotated[Settings, Depends(get_settings)]
) -> Filed:
    """Put the file at a public `url` into the vault at `path`, never over one there."""
    return Filed(path=await files.download(settings.vault_path, path, source.url))


@router.post(
    "/files/{path:path}",
    status_code=201,
    response_model=Filed,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            },
        }
    },
)
async def upload_file(
    path: str, request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> Filed | JSONResponse:
    """Put the raw body at `path`: a book or an image never overwrites, a page replaces.

    Raw rather than multipart, as `POST /api/assets/{path}` takes it, so `curl
    --data-binary @paper.pdf` is the whole client. `openapi_extra` because the
    body is read off the request, which FastAPI cannot see to describe.
    """
    # Picked by the suffix alone, lowered the way the vault lowers it; each
    # side checks the whole path again, so this choice grants nothing.
    write = page_store.store_page if path.lower().endswith(HTML_SUFFIX) else files.store
    try:
        landed = await write(settings.vault_path, path, request.stream())
    except ClientDisconnect:
        # Nobody is left to read an answer. Caught so a hang-up is not a
        # traceback; `store` has already taken the temp away.
        return JSONResponse(status_code=499, content={})

    return Filed(path=landed)


def _written(landed: agent.NoteRead | None) -> agent.NoteRead:
    """What the write left on disk, or the refusal a path the vault will not take earns."""
    if landed is None:
        raise HTTPException(status_code=404, detail="No such note")

    return landed


async def note_changed(_request: Request, error: Exception) -> JSONResponse:
    """Answer a refused write with the digest the caller needs to re-read and retry.

    Registered app-wide in `main.py`. The body is the MCP tool error's text, word for word.
    """
    # Narrowed rather than annotated. Starlette types every handler's second
    # argument as `Exception`, and this one is registered for one class.
    current = error.current if isinstance(error, agent.ConflictError) else None

    return JSONResponse(status_code=409, content={"detail": str(error), "current": current})


async def too_large(_request: Request, error: Exception) -> JSONResponse:
    """Answer a write that would leave more than `MOST_CONTENT_BYTES` on disk."""
    return JSONResponse(status_code=413, content={"detail": str(error)})


async def refused(_request: Request, error: Exception) -> JSONResponse:
    """Answer a file or page refused by `files.py`, with the status it earned.

    Registered app-wide, so `POST /api/assets` and `POST /agent/files` refuse alike.
    """
    status = error.status if isinstance(error, files.RefusedError) else 500

    return JSONResponse(status_code=status, content={"detail": str(error)})


async def nothing_to_capture(_request: Request, error: Exception) -> JSONResponse:
    """Answer a dump handed no words, with the status a malformed body gets.

    Registered app-wide, so `POST /api/dump` and `POST /agent/dump` refuse alike.
    """
    return JSONResponse(status_code=422, content={"detail": str(error)})
