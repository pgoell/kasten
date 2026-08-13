"""What an Anki `.apkg` export turns into, and what it refuses to import.

The fixtures are built here rather than checked in: an export is a zip around an
sqlite file, and a real one carries a hundred columns of scheduling state none of
this reads. The builder below writes only the columns the reader touches, in the
two schemas Anki has written, so a test says which schema it is about instead of
a binary blob saying nothing.
"""

import io
import json
import sqlite3
import tempfile
import zipfile
from compression import zstd
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend.anki import Deck, as_note, plain, read_apkg

if TYPE_CHECKING:
    from httpx import AsyncClient

# Tuples rather than lists so they can be default arguments: ruff refuses a
# mutable one, and every test that varies a fixture varies exactly one of them.
NOTES = ((1, "Bonjour\x1fhello"), (2, "Paris\x1fthe capital of France"))
CARDS = ((11, 1, 100), (12, 2, 200))
DECKS = ((100, "French"), (200, "Geography"))

EXPECTED = [
    Deck("French", [("Bonjour", "hello")], 0),
    Deck("Geography", [("Paris", "the capital of France")], 0),
]


def apkg(
    notes: tuple[tuple[int, str], ...] = NOTES,
    cards: tuple[tuple[int, int, int], ...] = CARDS,
    decks: tuple[tuple[int, str], ...] = DECKS,
    *,
    schema18: bool = False,
    member: str = "collection.anki2",
) -> bytes:
    """The bytes of an export holding `notes` in `decks`, in one of the two schemas."""
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "collection"
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT)")
            db.execute("CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER)")
            db.executemany("INSERT INTO notes VALUES (?, ?)", notes)
            db.executemany("INSERT INTO cards VALUES (?, ?, ?)", cards)
            if schema18:
                db.execute("CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT)")
                db.executemany("INSERT INTO decks VALUES (?, ?)", decks)
            else:
                listing = {str(did): {"name": name} for did, name in decks}
                db.execute("CREATE TABLE col (decks TEXT)")
                db.execute("INSERT INTO col VALUES (?)", (json.dumps(listing),))
        db.close()
        blob = path.read_bytes()

    return zipped(member, zstd.compress(blob) if member == "collection.anki21b" else blob)


def zipped(name: str, blob: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr(name, blob)
    return buffer.getvalue()


def test_plain_turns_a_break_into_a_space_and_strips_every_other_tag() -> None:
    # `<b>` leaves no space behind: only the four tags that end a line do.
    assert plain("one<br>two<br/>three</div>four</p><b>five</b>six") == "one two three four fivesix"


def test_plain_unescapes_entities() -> None:
    assert plain("salt&nbsp;&amp;&nbsp;pepper") == "salt & pepper"


def test_plain_drops_an_image_and_a_sound() -> None:
    assert plain('<img src="cat.jpg"> a cat [sound:meow.mp3] purring') == "a cat purring"


def test_plain_turns_a_cloze_into_a_highlight() -> None:
    assert plain("{{c1::Paris}} is the capital") == "==Paris== is the capital"


def test_plain_drops_a_cloze_hint() -> None:
    assert plain("{{c1::Paris::city}} is the capital") == "==Paris== is the capital"


def test_plain_answers_with_one_line() -> None:
    result = plain("first\nsecond  \t third \n")

    assert "\n" not in result
    assert result == "first second third"


def test_reads_two_decks_from_the_old_schema() -> None:
    assert read_apkg(apkg()) == EXPECTED


def test_reads_the_compressed_collection_the_same_way() -> None:
    assert read_apkg(apkg(member="collection.anki21b")) == EXPECTED


def test_reads_schema_18_the_same_way() -> None:
    assert read_apkg(apkg(schema18=True, member="collection.anki21")) == EXPECTED


def test_spells_a_nested_deck_with_a_slash_on_schema_18() -> None:
    data = apkg(decks=((100, "Certs\x1fAWS"), (200, "Geography")), schema18=True)

    assert read_apkg(data)[0].name == "Certs/AWS"


def test_spells_a_nested_deck_with_a_slash_on_the_old_schema() -> None:
    data = apkg(decks=((100, "Certs::AWS"), (200, "Geography")))

    assert read_apkg(data)[0].name == "Certs/AWS"


def test_imports_a_card_naming_an_image_and_counts_it() -> None:
    notes = ((1, '<img src="cat.jpg"> a cat\x1fle chat'),)
    data = apkg(notes=notes, cards=((11, 1, 100),), decks=((100, "French"),))

    assert read_apkg(data) == [Deck("French", [("a cat", "le chat")], 1)]


def test_skips_a_note_with_only_one_field() -> None:
    data = apkg(notes=((1, "Bonjour"), *NOTES[1:]))

    assert read_apkg(data) == EXPECTED[1:]


def test_skips_a_note_no_card_points_at() -> None:
    data = apkg(cards=CARDS[1:])

    assert read_apkg(data) == EXPECTED[1:]


def test_refuses_bytes_that_are_not_a_zip() -> None:
    with pytest.raises(ValueError, match="not a zip"):
        read_apkg(b"this is a note, not an export")


def test_refuses_a_zip_holding_no_collection() -> None:
    with pytest.raises(ValueError, match="no Anki collection"):
        read_apkg(zipped("media", b"{}"))


def test_writes_a_deck_as_a_tagged_note() -> None:
    deck = Deck("Certs/AWS", [("Bonjour", "hello"), ("", "orphan"), ("Paris", "the capital")], 0)

    assert as_note(deck) == "#flashcards/Certs/AWS\n\nBonjour::hello\nParis::the capital\n"


async def test_import_writes_one_note_per_deck(client: AsyncClient, vault: Path) -> None:
    export = apkg(
        notes=((1, "What is S3?\x1fSimple Storage"), (2, "What is EC2?\x1fElastic Compute")),
        cards=((1, 1, 10), (2, 2, 20)),
        decks=((10, "AWS"), (20, "Terraform")),
    )

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 201
    assert response.json() == {
        "notes": ["03 Flashcards/AWS.md", "03 Flashcards/Terraform.md"],
        "cards": 2,
        "dropped_media": 0,
    }
    written = (vault / "03 Flashcards" / "AWS.md").read_text(encoding="utf-8")
    # Stamped like every other note kasten writes, so the tag is under the block.
    assert "\n#flashcards/AWS\n" in written
    assert written.startswith("---\nid: ")
    assert "What is S3?::Simple Storage" in written


async def test_import_says_how_much_media_it_dropped(client: AsyncClient, vault: Path) -> None:
    export = apkg(
        notes=((1, '<img src="cat.jpg"> which cat?\x1fthe tabby'),),
        cards=((1, 1, 10),),
        decks=((10, "Cats"),),
    )

    response = await client.post("/api/anki", content=export)

    assert response.json()["dropped_media"] == 1
    assert "cat.jpg" not in (vault / "03 Flashcards" / "Cats.md").read_text(encoding="utf-8")


async def test_import_refuses_a_deck_already_imported(client: AsyncClient, vault: Path) -> None:
    export = apkg(notes=((1, "a\x1fb"),), cards=((1, 1, 10),), decks=((10, "AWS"),))
    await client.post("/api/anki", content=export)

    again = await client.post("/api/anki", content=export)

    assert again.status_code == 409
    assert "AWS" in again.json()["detail"]


async def test_import_refuses_a_deck_name_that_climbs_out(client: AsyncClient, vault: Path) -> None:
    export = apkg(notes=((1, "a\x1fb"),), cards=((1, 1, 10),), decks=((10, "../../etc/passwd"),))

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 400
    assert not (vault.parent / "etc").exists()


async def test_import_refuses_something_that_is_not_an_export(client: AsyncClient) -> None:
    response = await client.post("/api/anki", content=b"not a zip at all")

    assert response.status_code == 400
