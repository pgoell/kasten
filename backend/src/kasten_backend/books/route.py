"""The library's two reads: the book notes, and the cover inside each epub."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from kasten_backend.books.cover import epub_cover
from kasten_backend.books.library import LibraryBook, books
from kasten_backend.config import Settings, get_settings
from kasten_backend.vault import resolve_book

router = APIRouter()


@router.get("/api/library")
async def read_library(settings: Annotated[Settings, Depends(get_settings)]) -> list[LibraryBook]:
    """Every `type: Book` note outside the archive, hidden ones included, in path order."""
    return await books(settings)


@router.get(
    "/api/library/cover/{path:path}",
    response_class=Response,
    responses={200: {"content": {"image/*": {}}}, 304: {"description": "Not changed"}},
)
async def read_cover(
    path: str, request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> Response:
    """The cover of the epub beside the note at `path`, or 404 when it has none.

    The tag is the epub's size and time, so a pane drawn again asks once and gets a 304.
    """
    book = resolve_book(settings.vault_path, path)
    if book is None or book.suffix.lower() != ".epub":
        raise HTTPException(status_code=404, detail="No cover beside that note")

    stat = book.stat()
    tag = f'"{stat.st_size:x}-{stat.st_mtime_ns:x}"'
    headers = {"ETag": tag, "Cache-Control": "private, no-cache"}
    if request.headers.get("If-None-Match") == tag:
        return Response(status_code=304, headers=headers)

    cover = await asyncio.to_thread(epub_cover, book)
    if cover is None:
        raise HTTPException(status_code=404, detail="No cover beside that note")
    return Response(cover.data, media_type=cover.media_type, headers=headers)
