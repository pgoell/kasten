from typing import TYPE_CHECKING

from backend.tests.anki_build import BASIC, CLOZE, apkg

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_import_writes_one_note_per_deck(client: AsyncClient, vault: Path) -> None:
    export = apkg(
        notes=(
            (1, BASIC, "What is S3?\x1fSimple Storage"),
            (2, BASIC, "What is EC2?\x1fElastic Compute"),
        ),
        cards=((1, 1, 10, 0), (2, 2, 20, 0)),
        decks=((10, "AWS"), (20, "Terraform")),
    )

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 201
    assert response.json() == {
        "notes": ["03 Flashcards/AWS.md", "03 Flashcards/Terraform.md"],
        "cards": 2,
        "media": 0,
        "added": 2,
        "updated": 0,
        "kept": 0,
        "removed": 0,
    }
    written = (vault / "03 Flashcards" / "AWS.md").read_text(encoding="utf-8")
    # Stamped like every other note kasten writes, so the tag is under the block.
    assert "\n#flashcards/AWS\n" in written
    assert written.startswith("---\nid: ")
    assert "What is S3?::Simple Storage" in written


async def test_import_counts_the_cards_the_note_holds(client: AsyncClient, vault: Path) -> None:
    # The empty back cannot be written without `srs.ts` cutting the question at
    # `std`, so the note leaves it out, and the count must not promise it. A
    # back reading as a heading is escaped and kept (#234).
    export = apkg(
        notes=(
            (1, BASIC, "What does std::size count?\x1f# of elements"),
            (2, BASIC, "a\x1fb"),
            (3, BASIC, "What does std::move do?\x1f"),
        ),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 10, 0)),
        decks=((10, "Cpp"),),
    )

    response = await client.post("/api/anki", content=export)

    note = (vault / "03 Flashcards" / "Cpp.md").read_text(encoding="utf-8")
    assert response.json()["cards"] == 2
    assert "a::b" in note
    assert "?\n\\# of elements" in note
    assert "std::move" not in note


async def test_import_counts_each_cloze_number_as_a_card(client: AsyncClient, vault: Path) -> None:
    # One line, and the review asks it once as `c1` and once as `c2`.
    export = apkg(
        notes=((1, CLOZE, "{{c1::H}}{{c1::O}} and {{c2::water}}\x1f"), (2, BASIC, "a\x1fb")),
        cards=((1, 1, 10, 0), (2, 1, 10, 1), (3, 2, 10, 0)),
        decks=((10, "Chem"),),
    )

    response = await client.post("/api/anki", content=export)

    assert response.json()["cards"] == 3


async def test_import_refuses_a_deck_name_that_climbs_out(client: AsyncClient, vault: Path) -> None:
    export = apkg(
        notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "../../etc/passwd"),)
    )

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 400
    assert not (vault.parent / "etc").exists()


async def test_import_refuses_something_that_is_not_an_export(client: AsyncClient) -> None:
    response = await client.post("/api/anki", content=b"not a zip at all")

    assert response.status_code == 400


async def test_import_refuses_a_collection_with_no_note_types(client: AsyncClient) -> None:
    response = await client.post("/api/anki", content=apkg(types=(), schema18=True))

    assert response.status_code == 400


async def test_import_writes_no_block_into_a_reserved_name(
    client: AsyncClient, vault: Path
) -> None:
    # A deck named `index` lands on a filename OKF reserves, and kasten writes
    # no block into one of those whichever route the text arrived by.
    export = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "index"),))

    await client.post("/api/anki", content=export)

    assert "---" not in (vault / "03 Flashcards" / "index.md").read_text(encoding="utf-8")
