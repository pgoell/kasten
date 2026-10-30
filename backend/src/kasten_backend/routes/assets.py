"""Routes that move books and images in and out of the vault, and big uploads."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi import Path as Segment
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.requests import ClientDisconnect

from kasten_backend import files, uploads
from kasten_backend.change import vault_write
from kasten_backend.config import Settings, get_settings
from kasten_backend.files import store
from kasten_backend.routes.moves import TrashEntry
from kasten_backend.trash import move_to_trash
from kasten_backend.vault import (
    BOOK_SUFFIXES,
    relative_path,
    resolve_asset,
    resolve_book,
)

router = APIRouter()


@router.get("/api/assets/{path:path}", response_class=FileResponse)
async def read_asset(
    path: str, settings: Annotated[Settings, Depends(get_settings)]
) -> FileResponse:
    """Read one book or image out of the vault.

    The only endpoint that answers with bytes rather than with a note. It
    resolves a path, checks a suffix and streams a file; it never opens what it
    sends, so nothing here knows what an epub or a png is beyond its name.

    No `media_type`: `mimetypes` answers `application/epub+zip` for `.epub` and
    `image/png` for `.png`, and starlette reads it off the path. `Range` comes
    free with `FileResponse` and nothing uses it, the client asking for the whole
    file once.

    The `POST` below is the other half. Between them a book or an image gets into
    the vault and back out of it without a terminal.
    """
    asset = resolve_asset(settings.vault_path, path)
    if asset is None:
        raise HTTPException(status_code=404, detail="No such file")

    return FileResponse(asset)


@router.post("/api/assets/{path:path}", status_code=201, response_class=Response)
async def write_asset(
    path: str,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    upload: str | None = None,
) -> Response:
    """Put one book or image into the vault, and never over one already there.

    Both decorator arguments earn their place. Without `status_code` the runtime
    answers 201 while OpenAPI documents a 200; without `response_class` FastAPI
    documents the 201 as JSON carrying an empty schema, and
    `openapi-typescript` turns that into a body for a response that has none.

    `upload` names a file sent in pieces through `/api/uploads`, streamed
    through `store` in place of the body.
    """
    limit = files.UPLOAD_LIMIT_BYTES
    if upload is not None:
        async with uploads.finished(upload) as joined:
            await store(settings.vault_path, path, uploads.read(joined), limit=limit)
        return Response(status_code=201)

    try:
        await store(settings.vault_path, path, request.stream(), limit=limit)
    except ClientDisconnect:
        # Nothing reads this answer once the client is gone. It is here so a dropped upload
        # prints no traceback from run_asgi; `store` has already taken the temp away.
        return Response(status_code=499)

    return Response(status_code=201)


class UploadSize(BaseModel):
    """What a file sent in pieces will weigh once joined."""

    size: int
    """In bytes, at least one and at most `UPLOAD_LIMIT_BYTES`."""


class UploadStarted(BaseModel):
    """The upload a client sends its pieces to, and names when it finishes."""

    id: str


@router.post("/api/uploads", status_code=201)
async def start_upload(
    declared: UploadSize, settings: Annotated[Settings, Depends(get_settings)]
) -> UploadStarted:
    """Open an upload for a file too big for one request through Cloudflare.

    Sweeps every upload idle for over an hour on the way, so a file nobody
    finished costs its disk until the next one starts and no longer.
    """
    return UploadStarted(id=uploads.start(settings.upload_path, declared.size))


@router.put("/api/uploads/{upload}/{n}", status_code=204, response_class=Response)
async def write_piece(upload: str, n: Annotated[int, Segment(ge=0)], request: Request) -> Response:
    """Write piece `n` of an upload from the raw body: the next one, or the last one again.

    `response_class` for the reason `POST /api/assets/{path}` carries one.
    """
    try:
        await uploads.write(upload, n, request.stream())
    except ClientDisconnect:
        # Nobody reads this answer, for the reason `write_asset` gives, and
        # `write` has already cut the temp back so the piece can be sent again.
        return Response(status_code=499)

    return Response(status_code=204)


@router.delete("/api/assets/{path:path}")
async def delete_asset(
    path: str, settings: Annotated[Settings, Depends(get_settings)]
) -> TrashEntry:
    """Take one image out of the vault, and hold it in the trash.

    The note delete's route read for an image, down to the entry it answers
    with: `move_to_trash` moves whatever path it is handed, and the trash names
    an entry after where it came from, so an image sits in there beside the notes
    and `PATCH /api/trash/{entry}` puts it back with no rule of its own. That is
    what makes a mistyped key cost a keypress rather than a picture in a vault
    with no other delete.

    Images and sounds, though `resolve_asset` answers for books too. A sound has
    no note it travels with, so it goes the way an image does. A book travels
    with the note beside it, and which of the pair a delete should take is a
    decision nothing here has made; the file tree, which is what this route
    serves, lists images and no books. So a book is a 404 like any other path
    this does not serve, whichever of `BOOK_SUFFIXES` it ends in.

    The notes pointing at the image are left alone, for the reason the note
    delete leaves `[[link]]`s alone: rewriting them to say the picture is gone
    would be the one edit a restore could not take back. The editor draws a
    reference to a file that is not there as a picture that will not load.
    """
    async with vault_write():
        asset = resolve_asset(settings.vault_path, path)
        # Lowered, because `resolve_asset` answers for `Plan.PDF` too, and a
        # book missed here is one this deletes.
        if asset is None or asset.suffix.lower() in BOOK_SUFFIXES:
            raise HTTPException(status_code=404, detail="No such image")

        relative = relative_path(settings.vault_path, asset)

        return TrashEntry.of(await move_to_trash(settings.vault_path, asset, relative))


@router.get(
    "/api/books/{path:path}",
    response_class=FileResponse,
    responses={
        200: {
            "headers": {
                "X-Book-Path": {
                    "description": "Where the book that came back sits in the vault.",
                    # Spelled out so the generated client reads a string, present on every 200.
                    "required": True,
                    "schema": {"type": "string"},
                }
            }
        }
    },
)
async def read_book(
    path: str, settings: Annotated[Settings, Depends(get_settings)]
) -> FileResponse:
    """Read the book filed beside one note.

    The path is the note's, `20 Literature/DDIA.md`, and never the book's. The
    pair is a convention rather than a record, so the vault is the only thing
    that can resolve it: a client working from the note alone would have to ask
    for one suffix, read the 404 and ask for the next, which is a request per
    format and a guess about the order they should be tried in. Here it is one
    question, and `BOOK_SUFFIXES` answers it in the order the vault prefers.

    `X-Book-Path` says which of the pair came back, spelled from the vault root.
    A header rather than a body, the body being the book: the client names the
    file it hands the reader after this, and draws the path in the panel it puts
    up when a note has no book. Percent-encoded, because a header goes down the
    wire as latin-1 and a book called `Grundzüge.pdf` would otherwise raise on
    its way out.

    No `media_type`, for the reason the asset read gives: `mimetypes` answers
    `application/epub+zip` and `application/pdf` off the suffix, and starlette
    reads it off the path.
    """
    book = resolve_book(settings.vault_path, path)
    if book is None:
        raise HTTPException(status_code=404, detail="No book beside that note")

    relative = relative_path(settings.vault_path, book)

    return FileResponse(book, headers={"X-Book-Path": quote(relative)})
