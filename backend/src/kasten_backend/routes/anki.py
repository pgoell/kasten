"""Routes that import an Anki deck, from a file or a shared link, as one note per deck."""

import asyncio
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from kasten_backend import ankiweb, files, uploads
from kasten_backend.anki import media_path, read_apkg
from kasten_backend.anki_merge import marked_cards, merge
from kasten_backend.anki_note import as_note, card_count, note_cards
from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import Settings, get_settings
from kasten_backend.files import store
from kasten_backend.folders import create_note
from kasten_backend.frontmatter import reserved, stamp
from kasten_backend.search import notes_holding
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


@router.post("/api/anki", status_code=201)
async def import_anki(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    carry: bool = False,
    upload: str | None = None,
) -> AnkiImport:
    """Turn an Anki export into one markdown note per deck.

    The bytes come as the raw body rather than as a multipart form, the way
    `POST /api/assets/{path}` takes a book: one file, no fields beside it, and
    no dependency on a form parser for a request that carries nothing to parse.

    A deck already imported is merged into its note by `merge`, which keeps
    every schedule in it, since that is a note you may have answered fifty
    cards in. One imported before the cards carried their Anki ids is refused
    instead, there being no telling its cards apart. A deck whose cards another
    note already holds is refused too, since merging would add them a second time.

    `carry` writes Anki's schedule onto every card Anki has in review, as the
    comment a rating would leave, so the review picks up where Anki left off.
    Only on a card the import adds: one already in the note keeps kasten's.

    `upload` names a file sent in pieces through `/api/uploads`, read in place
    of the body, which is then empty.
    """
    if upload is None:
        # Counted as it arrives, so an over-cap body is refused before the rest
        # is read rather than held whole in RAM. The cap is read here, not bound
        # at import, so a test lowering it reaches this.
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
        async with uploads.finished(upload) as joined:
            # In a thread, as `read_apkg` is below: up to 1 GiB off the disk.
            body = await asyncio.to_thread(joined.read_bytes)
    return await _import_bytes(body, settings, carry=carry, limit=files.UPLOAD_LIMIT_BYTES)


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
            if not fresh:
                continue
            raise HTTPException(status_code=409, detail=f"{path} is already in the vault")
        media.append((path, data))
    return media


async def _marked_elsewhere(settings: Settings, own: set[str]) -> dict[tuple[int, int], set[str]]:
    """Which notes outside `own` hold each marked card, the archive left out as the review does."""
    paths = await notes_holding(settings.vault_path, "<!--anki:", skip=settings.archive_path)
    outside = [path for path in paths if path not in own]
    # One thread for every note, as `read_apkg` takes one for its unzip: a vault of
    # hundreds of notes would otherwise cost a hop each.
    texts = await asyncio.to_thread(_read_all, settings.vault_path, outside)
    elsewhere: dict[tuple[int, int], set[str]] = {}
    for path, text in texts.items():
        for key in marked_cards(text):
            elsewhere.setdefault(key, set()).add(path)
    return elsewhere


def _read_all(root: Path, paths: list[str]) -> dict[str, str]:
    """The text of each note in `paths`, read in turn."""
    return {path: (root / path).read_text(encoding="utf-8") for path in paths}


async def _import_bytes(body: bytes, settings: Settings, *, carry: bool, limit: int) -> AnkiImport:
    """Import the export `body`, the one implementation behind a file and a link.

    One, so the merge, its refusals and the summary are the same words
    whichever way the deck arrived. `limit` is the cap for that way.
    """
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
        # Every path resolved and every collision found before anything is
        # written, so an export whose fourth deck is refused leaves the first
        # three unwritten rather than half-importing and reporting a failure.
        # Outside the change, so a refused import leaves none behind.
        targets: list[tuple[Path, str, str | None]] = []
        media: list[tuple[str, bytes]] = []
        notes: list[str] = []
        added = updated = kept = removed = 0
        homes = [
            (deck, resolve_path(settings.vault_path, f"{settings.flashcards_path}/{deck.name}.md"))
            for deck in decks
        ]
        own = {relative_path(settings.vault_path, home) for _, home in homes if home is not None}
        elsewhere = await _marked_elsewhere(settings, own)
        for deck, note in homes:
            if note is None:
                raise HTTPException(status_code=400, detail=f"The vault will not take {deck.name}")
            target = relative_path(settings.vault_path, note)
            notes.append(target)
            fresh = not note.exists()
            old = "" if fresh else note.read_text(encoding="utf-8")
            # Only a card the note does not mark yet would be a second copy. The
            # other notes hold a split deck's parts, so merging here adds them twice.
            adding = {(card.nid, card.ord) for card in note_cards(deck)} - marked_cards(old)
            others = sorted({path for key in adding for path in elsewhere.get(key, ())})
            if others:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"{deck.name} already has cards in {', '.join(others)}. An import merges "
                        f"a deck into one note, {target}, so it would add them to it a second "
                        f"time. Join those notes into {target}, then import again."
                    ),
                )
            if fresh:
                targets.append((note, as_note(deck), None))
                added += len(note_cards(deck))
            else:
                merged = merge(old, deck)
                if merged is None:
                    raise HTTPException(
                        status_code=409, detail=f"{deck.name} is already in the vault"
                    )
                # Unchanged, it is not written: a stamp would date the note today.
                if merged.text != old:
                    targets.append((note, merged.text, old))
                added += merged.added
                updated += merged.updated
                kept += merged.kept
                removed += merged.removed
            media += _new_media(deck, settings, fresh=fresh)

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
    """Write an import's media and then its notes, each new or over the text it had.

    The media first, through the checks an upload meets; `read_apkg` made them
    already, so none refuses and no note links a missing file. A target holding
    the note's old text is a merge, written over it; one holding None is new.
    A write failing partway takes back what this import put down, removing what
    it made and putting back what it merged into, so the retry is not refused
    by its own leftovers: a `finally` rather than a catch, since every failure
    gets the same answer. The caller holds the lock and the change.
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
