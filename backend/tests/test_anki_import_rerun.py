from typing import TYPE_CHECKING

from backend.tests.anki_build import BASIC, apkg, mark, marked, unhashed

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_a_re_import_answers_with_what_it_added_updated_kept_and_removed(
    client: AsyncClient, vault: Path
) -> None:
    first = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd"), (3, BASIC, "e\x1ff")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 10, 0)),
        decks=((10, "AWS"),),
    )
    second = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fD"), (4, BASIC, "g\x1fh")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (4, 4, 10, 0)),
        decks=((10, "AWS"),),
    )
    await client.post("/api/anki", content=first)

    again = await client.post("/api/anki", content=second)

    assert again.status_code == 201
    assert again.json() == {
        "notes": ["03 Flashcards/AWS.md"],
        "cards": 3,
        "media": 0,
        "added": 1,
        "updated": 1,
        "kept": 1,
        "removed": 1,
    }
    note = unhashed((vault / "03 Flashcards" / "AWS.md").read_text(encoding="utf-8"))
    body = f"a::b{mark(1)}\nc::D{mark(2)}\ne::f{mark(3)}\ng::h{mark(4)}\n"
    assert note.endswith(f"\n#flashcards/AWS\n\n{body}")


async def test_an_unchanged_re_import_leaves_the_note_unwritten(
    client: AsyncClient, vault: Path
) -> None:
    export = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "AWS"),))
    await client.post("/api/anki", content=export)
    note = vault / "03 Flashcards" / "AWS.md"
    before = (note.read_bytes(), note.stat().st_mtime_ns)

    again = await client.post("/api/anki", content=export)

    assert again.status_code == 201
    assert again.json()["kept"] == 1
    assert (note.read_bytes(), note.stat().st_mtime_ns) == before


async def test_a_deck_note_with_no_marker_is_refused_and_left_alone(
    client: AsyncClient, vault: Path
) -> None:
    # Imported before the marker: nothing says which card is which.
    note = vault / "03 Flashcards" / "AWS.md"
    note.parent.mkdir()
    note.write_text("#flashcards/AWS\n\na::b\n", encoding="utf-8")
    export = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "AWS"),))

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 409
    assert "AWS" in response.json()["detail"]
    assert note.read_text(encoding="utf-8") == "#flashcards/AWS\n\na::b\n"


async def test_one_export_merges_an_existing_deck_and_creates_a_new_one(
    client: AsyncClient, vault: Path
) -> None:
    first = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "AWS"),))
    both = apkg(
        notes=((1, BASIC, "a\x1fB"), (2, BASIC, "c\x1fd")),
        cards=((1, 1, 10, 0), (2, 2, 20, 0)),
        decks=((10, "AWS"), (20, "GCP")),
    )
    await client.post("/api/anki", content=first)

    response = await client.post("/api/anki", content=both)

    assert response.status_code == 201
    assert response.json()["notes"] == ["03 Flashcards/AWS.md", "03 Flashcards/GCP.md"]
    assert (response.json()["added"], response.json()["updated"]) == (1, 1)
    folder = vault / "03 Flashcards"
    assert f"\na::B{marked(1, 'a::B')}\n" in (folder / "AWS.md").read_text(encoding="utf-8")
    assert f"\nc::d{marked(2, 'c::d')}\n" in (folder / "GCP.md").read_text(encoding="utf-8")
