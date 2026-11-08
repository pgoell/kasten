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
from kasten_backend.anki_merge import joined, marked_cards, merge, taken
from kasten_backend.anki_note import as_note, card_count, deck_tag, note_cards
from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import Settings, get_settings
from kasten_backend.files import store
from kasten_backend.folders import create_note
from kasten_backend.frontmatter import reserved, stamp
from kasten_backend.routes import anki_imports
from kasten_backend.routes.anki_imports import AnkiImporting
from kasten_backend.search import SearchError, notes_holding
from kasten_backend.vault import (
    relative_path,
    resolve_asset_path,
    resolve_path,
    write_note,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from kasten_backend.anki_deck import Card, Deck

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
    of the body, which is then empty. Its import runs on past the request: an
    answer within `anki_imports.ANSWER_BUDGET_SECONDS` is the one above, a slower one is a
    202, and `GET /api/anki/imports/{upload}` answers for it after.
    """
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


async def _marked_elsewhere(
    settings: Settings, own: set[str]
) -> tuple[dict[tuple[int, int], set[str]], dict[str, str]]:
    """Which notes outside `own` hold each marked card, and their text, archive left out."""
    try:
        paths = await notes_holding(settings.vault_path, "<!--anki:", skip=settings.archive_path)
    except SearchError as error:
        # A short listing could miss the part a split deck keeps elsewhere, so the
        # import is refused rather than written on a guess.
        raise HTTPException(
            status_code=503,
            detail=(
                "The vault could not be read whole, so the import cannot tell whether its "
                "cards sit in another note. Make the vault readable, then import again."
            ),
        ) from error
    outside = [path for path in paths if path not in own]
    # One thread for every note, as `read_apkg` takes one for its unzip: a vault of
    # hundreds of notes would otherwise cost a hop each.
    texts = await asyncio.to_thread(_read_all, settings.vault_path, outside)
    elsewhere: dict[tuple[int, int], set[str]] = {}
    for path, text in texts.items():
        for key in marked_cards(text):
            elsewhere.setdefault(key, set()).add(path)
    return elsewhere, texts


def _read_all(root: Path, paths: list[str]) -> dict[str, str]:
    """The text of each note in `paths` that is still there, read in turn."""
    texts: dict[str, str] = {}
    for path in paths:
        # Read with replacement, not skipped, since the ASCII markers still count.
        # Only a note gone since rg listed it is left out.
        try:
            texts[path] = (root / path).read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            continue
    return texts


def _moves(
    settings: Settings,
    decks: list[Deck],
    paths: dict[str, str],
    texts: dict[str, str],
    elsewhere: dict[tuple[int, int], set[str]],
) -> tuple[dict[str, str], dict[str, dict[tuple[int, int], list[str]]]]:
    """The notes that cards Anki moved to a deck of the export leave, cut, and what each deck gains.

    A card moves out of another deck's own note: one in the export, or one at its deck's path
    under its deck's tag. A note under the importing deck's tag is a split part, refused (#1177).
    """
    held = {path: marked_cards(text) for path, text in texts.items()}
    leaving: dict[str, list[Card]] = {}
    into: dict[tuple[int, int], str] = {}
    for deck in decks:
        target = paths[deck.name]
        froms = {
            (card.nid, card.ord): sorted(
                elsewhere.get((card.nid, card.ord), set())
                | {path for path in paths.values() if (card.nid, card.ord) in held.get(path, ())}
            )
            for card in note_cards(deck)
            if (card.nid, card.ord) not in held.get(target, ())
        }
        keys = {(card.nid, card.ord) for card in note_cards(deck)}
        # A part sits under the deck's tag, or holds only its cards with no deck's note
        # its own, as a moved note whose tag an older import wrote differently.
        parts = sorted(
            {
                p
                for f in froms.values()
                for p in f
                if _tagged(texts[p], deck.name)
                or (held[p] <= keys and not _deck_note(settings, p, texts, paths))
            }
        )
        if parts:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"{deck.name} already has cards in {', '.join(parts)}. An import merges "
                    f"a deck into one note, {target}, so it would add them to it a second "
                    f"time. Join those notes into {target}, then import again."
                ),
            )
        for key, found in froms.items():
            if len(found) > 1 or (found and not _deck_note(settings, found[0], texts, paths)):
                raise _stuck(deck.name, found, target)
            if found:
                leaving.setdefault(found[0], []).append(_card(deck, key))
                into[key] = deck.name
    cut: dict[str, str] = {}
    gains: dict[str, dict[tuple[int, int], list[str]]] = {}
    for path, cards in leaving.items():
        result = taken(texts[path], cards)
        if result is None:
            name = into[cards[0].nid, cards[0].ord]
            raise _stuck(name, [path], paths[name])
        cut[path] = result[0]
        for key, lines in result[1].items():
            gains.setdefault(into[key], {})[key] = lines
    return cut, gains


def _card(deck: Deck, key: tuple[int, int]) -> Card:
    """The card of `deck` with Anki note and template `key`."""
    return next(card for card in note_cards(deck) if (card.nid, card.ord) == key)


def _tagged(text: str, deck: str) -> bool:
    """Whether `text` has the tag line `as_note` heads the note of `deck` with."""
    return deck_tag(deck) in {line.rstrip() for line in text.split("\n")}


def _deck_note(settings: Settings, path: str, texts: dict[str, str], paths: dict[str, str]) -> bool:
    """Whether `path` is a deck's own note: the export's, or at its deck's path under its tag."""
    folder = f"{settings.flashcards_path}/"
    name = path.removeprefix(folder).removesuffix(".md")
    own = path == f"{folder}{name}.md" and _tagged(texts[path], name)
    return path in paths.values() or own


def _stuck(deck: str, notes: list[str], target: str) -> HTTPException:
    """The refusal for cards of `deck` in `notes` that no move can tell apart safely (#1178)."""
    return HTTPException(
        status_code=409,
        detail=(
            f"{deck} has cards in {', '.join(notes)} that the import cannot move into "
            f"{target} safely, as no other deck's own note holds them, or they were edited "
            f"over several lines. Move each card's lines into {target}, then import again."
        ),
    )


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
            # "Join" advice of `_moves` would only lead to its cards doubled.
            if paths[deck.name] in olds and not marked_cards(olds[paths[deck.name]]):
                raise HTTPException(status_code=409, detail=f"{deck.name} is already in the vault")
        elsewhere, texts = await _marked_elsewhere(settings, set(paths.values()))
        cut, gains = _moves(settings, [deck for deck, _ in homes], paths, olds | texts, elsewhere)
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
                merged = merge(joined(base, list(moved.values())), deck)
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
