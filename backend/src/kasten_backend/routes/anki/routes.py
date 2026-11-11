"""Routes that import an Anki deck, from a file or a shared link, as one note per deck."""

import asyncio
from dataclasses import replace
from functools import partial
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import (
    JSONResponse,  # noqa: TC002  FastAPI reads the return annotation at runtime
)
from pydantic import BaseModel

from kasten_backend import ankiweb, files, uploads
from kasten_backend.anki import media_path, read_apkg
from kasten_backend.anki_merge import joined, marked_cards, merge
from kasten_backend.anki_note import as_note, card_count, note_cards
from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import Settings, get_settings
from kasten_backend.files import store
from kasten_backend.folders import create_note
from kasten_backend.frontmatter import reserved, stamp
from kasten_backend.routes.anki import imports as anki_imports
from kasten_backend.routes.anki.card_moves import marked_elsewhere, moves
from kasten_backend.routes.anki.imports import AnkiImporting
from kasten_backend.vault import (
    relative_path,
    resolve_asset_path,
    resolve_path,
    write_note,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from kasten_backend.anki_deck import Deck

router = APIRouter()


class AnkiImport(BaseModel):
    """What one `.apkg` turned into."""

    notes: list[str]
    """The note of every deck, in the order the decks were named, written or not.

    A re-import that changed nothing in a deck leaves its note as it was, and
    still names it, since it is where that deck lives.
    """

    cards: int
    """How many cards arrived, counting every deck."""

    media: int
    """How many images and sounds were written beside the notes.

    Once per deck that links a file, since each deck's note keeps its media in
    a folder of its own. A file the vault would not take is not counted, and
    its card holds no link to it. Nor is one a re-import found already there.
    """

    added: int
    """Cards the notes did not hold, every card of a deck imported the first time.

    This and the three below count a marker each, the line `<!--anki:NID:ORD-->`
    ends, so a cloze is one however many numbers it asks; `cards` counts those.
    """

    updated: int
    """Cards whose text Anki changed, rewritten with their schedule kept."""

    kept: int
    """Cards already in the note as the export has them, left untouched."""

    removed: int
    """Cards the note holds and the export no longer does, left in the note."""


@router.post(
    "/api/anki",
    status_code=201,
    response_model=AnkiImport,
    responses={202: {"model": AnkiImporting}},
)
async def import_anki(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    carry: bool = False,
    upload: str | None = None,
) -> AnkiImport | JSONResponse:
    """Turn an Anki export into one markdown note per deck."""
    if upload is None:
        # Counted as it arrives, so an over-cap body is refused before it is held in RAM.
        # Read here, not at import, so a test lowering the cap reaches this.
        limit = files.UPLOAD_LIMIT_BYTES
        pieces: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise HTTPException(status_code=413, detail=files.too_big(limit))
            pieces.append(chunk)
        body = b"".join(pieces)
    else:
        work = partial(_from_upload, upload, settings, carry=carry)
        return await anki_imports.answer(
            upload, anki_imports.started(upload, work, {"carry": carry})
        )
    return await _import_bytes(body, settings, carry=carry, limit=files.UPLOAD_LIMIT_BYTES)


async def _from_upload(key: str, settings: Settings, *, carry: bool) -> AnkiImport:
    """Import the file of upload `key`, kept on disk if the import does not land."""
    async with uploads.taken(key) as joined:
        # In a thread, as `read_apkg` is below: up to 1 GiB off the disk.
        body = await asyncio.to_thread(joined.read_bytes)
        return await _import_bytes(body, settings, carry=carry, limit=files.UPLOAD_LIMIT_BYTES)


@router.get(
    "/api/anki/imports/{upload}",
    response_model=AnkiImport,
    responses={202: {"model": AnkiImporting}},
)
async def anki_import(upload: str) -> JSONResponse:
    """What the finish of `upload` would answer now: 202 while it runs, else its outcome.

    The counts with a 200, or the refusal with the status and sentence the
    finish gives it. A 404 for an import this process never ran, a restart
    being the likely cause: it forgets every import and wipes every upload.
    """
    return anki_imports.outcome(upload)


class DeckLink(BaseModel):
    """Where a deck to import lives."""

    url: str
    """An AnkiWeb shared deck's page, `ankiweb.net/shared/info/<id>`, or an https `.apkg`."""


@router.post("/api/anki/link", status_code=201)
async def import_anki_link(
    link: DeckLink, settings: Annotated[Settings, Depends(get_settings)], carry: bool = False
) -> AnkiImport:
    """Fetch the deck a link names and import it as `POST /api/anki` imports a file.

    The fetch is `ankiweb.fetch_deck`'s, and its refusals reach the reader
    through the `RefusedError` handler. Nothing is written until the bytes are
    all here, so a link that fails leaves the vault as it was.
    """
    return await _import_bytes(
        await ankiweb.fetch_deck(link.url), settings, carry=carry, limit=files.ASSET_LIMIT_BYTES
    )


def _new_media(deck: Deck, settings: Settings, *, fresh: bool) -> list[tuple[str, bytes]]:
    """The files of `deck` to write, by vault path, refusing one the vault will not take."""
    media: list[tuple[str, bytes]] = []
    for name, data in deck.media.items():
        path = media_path(settings.flashcards_path, deck.name, name)
        asset = resolve_asset_path(settings.vault_path, path)
        if asset is None:
            raise HTTPException(status_code=400, detail=f"The vault will not take {path}")
        if asset.exists():
            # A merged deck's media is most likely this import's own
            # from last time, and a card links it by name either way.
            if not fresh or _same(asset, data):
                continue
            raise HTTPException(status_code=409, detail=f"{path} is already in the vault")
        media.append((path, data))
    return media


def _same(asset: Path, data: bytes) -> bool:
    """Whether `asset` holds `data` already, as a hard-killed import leaves it (#1311)."""
    return asset.is_file() and asset.stat().st_size == len(data) and asset.read_bytes() == data


async def _import_bytes(body: bytes, settings: Settings, *, carry: bool, limit: int) -> AnkiImport:
    """Import the export `body`, the one path behind a file and a link; `limit` caps that way."""
    if len(body) > limit:
        raise HTTPException(status_code=413, detail=files.too_big(limit))

    try:
        # In a worker thread: unzipping, zstd and sqlite take seconds on a big
        # deck, and on the event loop every other request would wait them out.
        decks = await asyncio.to_thread(read_apkg, body, settings.flashcards_path, carry=carry)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    # The whole import under one lock, so a deck found free by the precheck
    # cannot be taken by another writer before the loop below reaches it.
    async with vault_write():
        # Every path and collision is found before any write, so a refused deck writes nothing.
        # Outside the change, so a refused import leaves none behind.
        targets: list[tuple[Path, str, str | None]] = []
        media: list[tuple[str, bytes]] = []
        notes: list[str] = []
        added = updated = kept = removed = 0
        homes: list[tuple[Deck, Path]] = []
        for deck in decks:
            note = resolve_path(settings.vault_path, f"{settings.flashcards_path}/{deck.name}.md")
            if note is None:
                raise HTTPException(status_code=400, detail=f"The vault will not take {deck.name}")
            homes.append((deck, note))
        paths = {deck.name: relative_path(settings.vault_path, note) for deck, note in homes}
        olds = {
            paths[deck.name]: note.read_text(encoding="utf-8")
            for deck, note in homes
            if note.exists()
        }
        for deck, _ in homes:
            # A note from before the marker gets the refusal it always got: the
            # "Join" advice of `moves` would only lead to its cards doubled.
            if paths[deck.name] in olds and not marked_cards(olds[paths[deck.name]]):
                raise HTTPException(status_code=409, detail=f"{deck.name} is already in the vault")
        elsewhere, texts = await marked_elsewhere(settings, set(paths.values()))
        cut, gains = moves(settings, [deck for deck, _ in homes], paths, olds | texts, elsewhere)
        for deck, note in homes:
            target = paths[deck.name]
            notes.append(target)
            disk = olds.get(target)
            fresh = disk is None
            moved = gains.get(deck.name, {})
            if fresh and not moved:
                targets.append((note, as_note(deck), None))
                added += len(note_cards(deck))
            else:
                fresh_cards = [c for c in note_cards(deck) if (c.nid, c.ord) not in moved]
                base = as_note(replace(deck, cards=fresh_cards)) if fresh else cut.get(target, disk)
                merged = merge(joined(base, list(moved.values())) if moved else base, deck)
                # Unchanged, it is not written: a stamp would date the note today.
                if merged.text != disk:
                    targets.append((note, merged.text, disk))
                # A fresh note's other cards are new, though `merge` found them in `base`.
                new = len(fresh_cards) if fresh else 0
                added += merged.added + new
                updated += merged.updated
                kept += merged.kept - new
                removed += merged.removed
            media += _new_media(deck, settings, fresh=fresh)
        # A card's old note outside the export loses its lines in the same change.
        targets += [
            (settings.vault_path / path, text, texts[path])
            for path, text in cut.items()
            if path not in olds
        ]

        # One change for the import rather than one per deck, the way the type
        # backfill takes one for its pass.
        async with vault_change(settings.vault_path, settings.flashcards_path):
            await _write_import(settings.vault_path, media, targets)

    return AnkiImport(
        notes=notes,
        # What the notes hold, not what Anki made: `as_note` leaves some out,
        # and a cloze line is a card per number.
        cards=sum(card_count(deck) for deck in decks),
        media=len(media),
        added=added,
        updated=updated,
        kept=kept,
        removed=removed,
    )


async def _write_import(
    root: Path, media: list[tuple[str, bytes]], targets: list[tuple[Path, str, str | None]]
) -> None:
    """Write an import's media, then its notes, each new or merged over its old text.

    A failure partway takes back what this import wrote, so a retry is not refused by its leftovers.
    """
    landed: list[Path] = []
    merged: list[tuple[Path, str]] = []
    done = False
    try:
        for path, data in media:
            landed.append(root / await store(root, path, _once(data), held=True))
        for note, text, old in targets:
            written = text if reserved(relative_path(root, note)) else stamp(text, old or "")
            if old is None:
                create_note(note, written)
                landed.append(note)
            else:
                write_note(note, written)
                merged.append((note, old))
        done = True
    finally:
        if not done:
            for path in landed:
                path.unlink(missing_ok=True)
            for note, old in merged:
                write_note(note, old)


async def _once(data: bytes) -> AsyncIterator[bytes]:
    """`data` as the stream `store` reads, in one piece."""
    yield data
