"""The cards other notes hold, and the moves an import makes of them into the decks it writes."""

import asyncio
from typing import TYPE_CHECKING

from fastapi import HTTPException

from kasten_backend.anki.note.merge import marked_cards, taken
from kasten_backend.anki.note.write import deck_tag, note_cards
from kasten_backend.search import SearchError, notes_holding

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.anki.archive.deck import Deck
    from kasten_backend.config import Settings


async def marked_elsewhere(
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


def moves(
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
    leaving: dict[str, list[tuple[int, int]]] = {}
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
                leaving.setdefault(found[0], []).append(key)
                into[key] = deck.name
    cut: dict[str, str] = {}
    gains: dict[str, dict[tuple[int, int], list[str]]] = {}
    for path, keys in leaving.items():
        name = into[keys[0]]
        why = f"{name}'s cards cannot move out of it"
        text = texts[path] if path in paths.values() else strict(settings, path, why)
        result = taken(text, keys)
        if result is None:
            raise _stuck(name, [path], paths[name])
        cut[path] = result[0]
        for key, lines in result[1].items():
            gains.setdefault(into[key], {})[key] = lines
    return cut, gains


def strict(settings: Settings, path: str, why: str) -> str:
    """The text of `path` read strictly, as the import writes it back; else a 409 saying `why`."""
    try:
        return (settings.vault_path / path).read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise HTTPException(
            status_code=409,
            detail=f"{path} is not UTF-8, so {why}. Save it as UTF-8, then import again.",
        ) from error


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
