from typing import Any

import pytest

from backend.tests.anki_build import (
    CARDS,
    LAYOUTS,
    NOTES,
    apkg,
    legacy_type,
    one_deck,
    sqlite3_bytes,
    zipped,
)
from kasten_backend.anki import read_apkg


@pytest.mark.parametrize("layout", LAYOUTS)
def test_refuses_a_collection_with_no_note_types(layout: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="no note types"):
        read_apkg(apkg(types=(), **layout))


@pytest.mark.parametrize("layout", LAYOUTS)
def test_refuses_notes_whose_note_type_is_not_there(layout: dict[str, Any]) -> None:
    notes = ((1, 404, "Bonjour\x1fhello"),)

    with pytest.raises(ValueError, match="no note type"):
        read_apkg(apkg(notes, CARDS[:1], **layout))


def test_refuses_a_collection_without_note_type_tables() -> None:
    blob = sqlite3_bytes(
        "CREATE TABLE notes (id, mid, flds)",
        "CREATE TABLE cards (id, nid, did, ord)",
        "CREATE TABLE decks (id, name)",
        row=("INSERT INTO notes VALUES (1, 1, ?)", ("a\x1fb",)),
    )

    with pytest.raises(ValueError, match="unreadable"):
        read_apkg(zipped("collection.anki21", blob))


@pytest.mark.parametrize(
    "config",
    [b"\x0a\x05abc", b"\x0a", b"\x0b\x00", b"\x80"],
    ids=["string-too-long", "no-length", "group", "unfinished-varint"],
)
def test_refuses_a_broken_protobuf_config(config: bytes) -> None:
    blob = sqlite3_bytes(
        "CREATE TABLE notes (id, mid, flds)",
        "CREATE TABLE cards (id, nid, did, ord)",
        "CREATE TABLE decks (id, name)",
        "CREATE TABLE notetypes (id, name, config)",
        "CREATE TABLE fields (ntid, ord, name)",
        "CREATE TABLE templates (ntid, ord, name, config)",
        "INSERT INTO notetypes VALUES (1, 'Basic', x'')",
        row=("INSERT INTO templates VALUES (1, 0, 'Card 1', ?)", (config,)),
    )

    with pytest.raises(ValueError, match="protobuf"):
        read_apkg(zipped("collection.anki21", blob))


@pytest.mark.parametrize(
    "models",
    [
        "{not json",
        '{"1": {"name": "Basic"}}',
        "[1]",
        legacy_type(qfmt=None),
        legacy_type(afmt=3),
        legacy_type(field=["F"]),
    ],
    ids=["not-json", "no-fields", "list", "qfmt-null", "afmt-int", "field-list"],
)
def test_refuses_note_types_it_cannot_read(models: str) -> None:
    blob = sqlite3_bytes(
        "CREATE TABLE notes (id, mid, flds)",
        "CREATE TABLE cards (id, nid, did, ord)",
        "CREATE TABLE col (decks, models)",
        "INSERT INTO notes VALUES (1, 1, 'a')",
        "INSERT INTO cards VALUES (1, 1, 1, 0)",
        row=("INSERT INTO col VALUES (?, ?)", ('{"1": {"name": "D"}}', models)),
    )

    with pytest.raises(ValueError):
        read_apkg(zipped("collection.anki2", blob))


@pytest.mark.parametrize("layout", LAYOUTS)
def test_skips_a_card_whose_template_or_note_type_is_not_there(layout: dict[str, Any]) -> None:
    notes = (*NOTES[:1], (3, 404, "lost\x1fnote"))
    cards = ((11, 1, 100, 0), (12, 1, 100, 5), (31, 3, 100, 0))

    assert one_deck(notes, cards, **layout) == [("Bonjour", "hello")]


def test_refuses_bytes_that_are_not_a_zip() -> None:
    with pytest.raises(ValueError, match="not a zip"):
        read_apkg(b"this is a note, not an export")


def test_refuses_a_zip_holding_no_collection() -> None:
    with pytest.raises(ValueError, match="no Anki collection"):
        read_apkg(zipped("media", b"{}"))
