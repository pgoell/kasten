"""A deck split over several notes, and a re-import that would give its cards a second note."""

from typing import TYPE_CHECKING

from backend.tests.anki_build import BASIC, apkg

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

TWO_CARDS = apkg(
    notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd")),
    cards=((1, 1, 10, 0), (2, 2, 10, 0)),
    decks=((10, "AWS"),),
)


def _split_out(vault: Path, nid: int, part: str) -> None:
    """Move card `nid` out of AWS.md into the note `part`, the way a hand split does."""
    folder = vault / "03 Flashcards"
    # Up to the hash, which `mark` leaves off and the file keeps.
    marker = f"<!--anki:{nid}:0:"
    lines = (folder / "AWS.md").read_text(encoding="utf-8").split("\n")
    (folder / "AWS.md").write_text(
        "\n".join(line for line in lines if marker not in line), encoding="utf-8"
    )
    moved = "\n".join(line for line in lines if marker in line)
    (vault / part).parent.mkdir(parents=True, exist_ok=True)
    (vault / part).write_text(f"#flashcards/AWS\n\n{moved}\n", encoding="utf-8")


async def test_a1_a_re_import_of_a_deck_split_over_two_notes_is_refused(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    _split_out(vault, 2, "03 Flashcards/AWS 2.md")

    response = await client.post("/api/anki", content=TWO_CARDS)

    assert response.status_code == 409


async def test_a2_the_refusal_leaves_both_notes_as_they_were(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    _split_out(vault, 2, "03 Flashcards/AWS 2.md")
    folder = vault / "03 Flashcards"
    before = ((folder / "AWS.md").read_bytes(), (folder / "AWS 2.md").read_bytes())

    await client.post("/api/anki", content=TWO_CARDS)

    assert ((folder / "AWS.md").read_bytes(), (folder / "AWS 2.md").read_bytes()) == before


async def test_a3_the_refusal_names_the_other_note(client: AsyncClient, vault: Path) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    _split_out(vault, 2, "03 Flashcards/AWS 2.md")

    response = await client.post("/api/anki", content=TWO_CARDS)

    assert "03 Flashcards/AWS 2.md" in response.text


async def test_a4_the_refusal_says_to_join_the_notes_into_the_decks_note(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    _split_out(vault, 2, "03 Flashcards/AWS 2.md")

    response = await client.post("/api/anki", content=TWO_CARDS)

    assert "Join those notes into 03 Flashcards/AWS.md" in response.text


async def test_i1_a_deck_whose_note_was_moved_away_is_refused_and_writes_no_note(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    folder = vault / "03 Flashcards"
    (folder / "Old").mkdir()
    (folder / "AWS.md").rename(folder / "Old" / "AWS.md")

    response = await client.post("/api/anki", content=TWO_CARDS)

    assert (response.status_code, (folder / "AWS.md").exists()) == (409, False)


async def test_i2_an_export_with_one_split_deck_leaves_the_other_decks_note_unwritten(
    client: AsyncClient, vault: Path
) -> None:
    both = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd"), (3, BASIC, "e\x1ff")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 20, 0)),
        decks=((10, "AWS"), (20, "GCP")),
    )
    changed = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd"), (3, BASIC, "e\x1fF")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 20, 0)),
        decks=((10, "AWS"), (20, "GCP")),
    )
    await client.post("/api/anki", content=both)
    _split_out(vault, 2, "03 Flashcards/AWS 2.md")
    gcp = vault / "03 Flashcards" / "GCP.md"
    before = gcp.read_bytes()

    await client.post("/api/anki", content=changed)

    assert gcp.read_bytes() == before


async def test_i3_a_note_with_the_decks_tag_and_hand_written_cards_does_not_block_a_re_import(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    (vault / "03 Flashcards" / "Mine.md").write_text("#flashcards/AWS\n\nx::y\n", encoding="utf-8")
    grown = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd"), (3, BASIC, "e\x1ff")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 10, 0)),
        decks=((10, "AWS"),),
    )

    response = await client.post("/api/anki", content=grown)

    assert response.status_code == 201


async def test_i4_a_part_in_the_archive_does_not_block_a_re_import(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    _split_out(vault, 2, "98 Archive/AWS 2.md")

    response = await client.post("/api/anki", content=TWO_CARDS)

    assert response.status_code == 201


async def test_b1_a_marked_note_that_is_not_utf8_does_not_fail_the_import(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    (vault / "03 Flashcards" / "Bad.md").write_bytes(
        b"#flashcards/Other\n\n\xff\n<!--anki:99:0:deadbeef-->\n"
    )
    grown = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd"), (3, BASIC, "e\x1ff")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 10, 0)),
        decks=((10, "AWS"),),
    )

    response = await client.post("/api/anki", content=grown)

    assert response.status_code == 201


async def test_b2_an_import_over_a_vault_rg_cannot_read_whole_says_why(
    client: AsyncClient, vault: Path
) -> None:
    locked = vault / "Locked"
    locked.mkdir()
    locked.chmod(0)
    try:
        response = await client.post("/api/anki", content=TWO_CARDS)
    finally:
        locked.chmod(0o755)

    assert "could not be read whole" in response.text


async def test_d4_a_note_from_before_the_marker_is_refused_as_before_when_its_cards_sit_elsewhere(
    client: AsyncClient, vault: Path
) -> None:
    folder = vault / "03 Flashcards"
    folder.mkdir()
    (folder / "AWS.md").write_text("#flashcards/AWS\n\na::b\n", encoding="utf-8")
    (folder / "AWS 2.md").write_text(
        "#flashcards/AWS\n\nc::d <!--anki:2:0:deadbeef-->\n", encoding="utf-8"
    )

    response = await client.post("/api/anki", content=TWO_CARDS)

    assert "AWS is already in the vault" in response.text
