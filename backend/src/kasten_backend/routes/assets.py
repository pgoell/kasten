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
    TABLE_SUFFIX,
    relative_path,
    resolve_asset,
    resolve_book,
)

router = APIRouter()

SVG_HEADERS = {
    # An svg opened as a page of its own would run its script on kasten's origin. As an
    # `<img>` it runs none; this holds the tab too, while styles and data: pictures still draw.
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox"
    ),
    "X-Content-Type-Options": "nosniff",
}

TABLE_HEADERS = {"X-Content-Type-Options": "nosniff"}
"""So no browser reads a csv opened in a tab as html, whatever its cells hold."""


@router.get("/api/assets/{path:path}", response_class=FileResponse)
async def read_asset(
    path: str, settings: Annotated[Settings, Depends(get_settings)]
) -> FileResponse:
    """Read one book, image or sound out of the vault, streamed unopened."""
    asset = resolve_asset(settings.vault_path, path)
    if asset is None:
        raise HTTPException(status_code=404, detail="No such file")

    if asset.suffix.lower() == ".svg":
        return FileResponse(asset, media_type="image/svg+xml", headers=SVG_HEADERS)
    if asset.suffix.lower() == TABLE_SUFFIX:
        return FileResponse(asset, media_type="text/csv; charset=utf-8", headers=TABLE_HEADERS)
    return FileResponse(asset)


# Without status_code OpenAPI documents a 200; without response_class it documents
# a JSON body, which openapi-typescript turns into a body this answer never has.
@router.post("/api/assets/{path:path}", status_code=201, response_class=Response)
async def write_asset(
    path: str,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    upload: str | None = None,
) -> Response:
    """Put one book, image or sound into the vault, and never over one already there.

    `upload` names a file sent in pieces through `/api/uploads`, read in place of the body.
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
    """Take one image or sound out of the vault, and hold it in the trash."""
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
    """Read the book filed beside one note, named in `X-Book-Path`."""
    book = resolve_book(settings.vault_path, path)
    if book is None:
        raise HTTPException(status_code=404, detail="No book beside that note")

    relative = relative_path(settings.vault_path, book)

    return FileResponse(book, headers={"X-Book-Path": quote(relative)})
