import io
import zipfile
from compression import zstd
from typing import Any

import pytest

from backend.tests.anki_build import (
    BASIC,
    CARDS,
    LAYOUTS,
    MP3,
    PNG,
    REVERSED,
    apkg,
    proto,
    sides,
    zipped,
)
from kasten_backend.anki import read_apkg


@pytest.mark.parametrize("layout", LAYOUTS)
def test_carries_media_from_either_form_of_the_map(layout: dict[str, Any]) -> None:
    notes = ((1, REVERSED, '<img src="cat.png"> a cat [sound:meow.mp3]\x1fle chat'),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1))
    media = (("unused.png", PNG), ("cat.png", PNG), ("meow.mp3", MP3))

    decks = read_apkg(apkg(notes, cards, ((100, "French"),), media=media, **layout), "F")

    link = "![](F/French%20media/cat.png) a cat ![](F/French%20media/meow.mp3)"
    assert sides(decks) == {"French": [(link, "le chat"), ("le chat", link)]}
    assert decks[0].media == {"cat.png": PNG, "meow.mp3": MP3}


def test_reads_a_media_entry_by_its_legacy_zip_name() -> None:
    # An entry carrying `legacy_zip_filename` lives under that number, not its index.
    entries = proto(1, proto(1, "cat.png") + proto(2, len(PNG)) + proto(255, 7))
    plain_export = apkg(((1, BASIC, '<img src="cat.png">\x1fa cat'),))
    collection = zipfile.ZipFile(io.BytesIO(plain_export)).read("collection.anki2")
    export = zipped(
        "collection.anki2",
        collection,
        ("media", zstd.compress(entries)),
        ("7", zstd.compress(PNG)),
    )

    decks = read_apkg(export)

    assert decks[0].cards[0].front == "![](French%20media/cat.png)"
    assert decks[0].media == {"cat.png": PNG}


@pytest.mark.parametrize(
    ("name", "data"),
    [("cat.svg", b"<svg/>"), ("cat.png", MP3), ("cat.png", None), ("cat.pdf", b"%PDF-1")],
    ids=["suffix", "magic", "missing", "book"],
)
def test_drops_media_it_cannot_carry(name: str, data: bytes | None) -> None:
    notes = ((1, BASIC, f'<img src="{name}"> a cat\x1fle chat'),)

    decks = read_apkg(apkg(notes, CARDS[:1], media=((name, data),)))

    assert sides(decks) == {"French": [("a cat", "le chat")]}
    assert decks[0].media == {}


def test_encodes_a_media_name_into_a_link_that_works() -> None:
    # `encodePath` in `note-path.ts`, and `:` and the parens besides: a `::` would
    # split the card line and a lone paren would end the link.
    name = "my cat (1) #2?ü:x.png"
    notes = ((1, BASIC, f"<img src='{name}'>\x1fa cat"),)

    decks = read_apkg(apkg(notes, CARDS[:1], media=((name, PNG),)), "03 Flashcards")

    assert decks[0].cards[0].front == (
        "![](03%20Flashcards/French%20media/my%20cat%20%281%29%20%232%3F%C3%BC%3Ax.png)"
    )


@pytest.mark.parametrize("name", ["../cat.png", "a/cat.png", "..", "", f"{'x' * 252}.png"])
def test_carries_no_media_name_that_leaves_its_folder(name: str) -> None:
    notes = ((1, BASIC, f'<img src="{name}"> a cat\x1fle chat'),)

    decks = read_apkg(apkg(notes, CARDS[:1], media=((name, PNG),)))

    assert decks[0].cards[0].front == "a cat"
    assert decks[0].media == {}
