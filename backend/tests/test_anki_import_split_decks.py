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


SR = "<!--SR:!2026-12-01,3,250-->"
AWS_GCP = apkg(
    notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd"), (3, BASIC, "e\x1ff")),
    cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 20, 0)),
    decks=((10, "AWS"), (20, "GCP")),
)
MOVED = apkg(
    notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd"), (3, BASIC, "e\x1ff")),
    cards=((1, 1, 10, 0), (2, 2, 20, 0), (3, 3, 20, 0)),
    decks=((10, "AWS"), (20, "GCP")),
)
MOVED_GCP = apkg(
    notes=((2, BASIC, "c\x1fd"), (3, BASIC, "e\x1ff")),
    cards=((2, 2, 20, 0), (3, 3, 20, 0)),
    decks=((20, "GCP"),),
)


def _rate(vault: Path, note: str, nid: int, *, edit: str = "") -> None:
    """Give card `nid` of `note` a schedule as a rating does, `edit` added to its last line."""
    path = vault / "03 Flashcards" / note
    lines = path.read_text(encoding="utf-8").split("\n")
    at = next(i for i, line in enumerate(lines) if f"<!--anki:{nid}:0:" in line)
    head, marker = lines[at].split(" <!--anki:")
    block = at > 0 and bool(lines[at - 1].strip()) and "<!--anki:" not in lines[at - 1]
    lines[at] = f"{head}{edit} <!--anki:{marker}" + ("" if block else f" {SR}")
    if block:
        lines.insert(at + 1, SR)
    path.write_text("\n".join(lines), encoding="utf-8")


def _holding(vault: Path, nid: int) -> list[str]:
    """Every note outside the archive whose lines mark card `nid`."""
    return sorted(
        path.name
        for path in (vault / "03 Flashcards").glob("*.md")
        if f"<!--anki:{nid}:0:" in path.read_text(encoding="utf-8")
    )


def _line(vault: Path, note: str, nid: int) -> str:
    text = (vault / "03 Flashcards" / note).read_text(encoding="utf-8")
    return next(line for line in text.split("\n") if f"<!--anki:{nid}:0:" in line)


async def test_m1_a_card_moved_between_two_decks_imported_together_is_asked_once(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)

    response = await client.post("/api/anki", content=MOVED)

    assert (response.status_code, _holding(vault, 2)) == (201, ["GCP.md"])


async def test_m2_the_card_moved_with_both_decks_keeps_its_schedule(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    _rate(vault, "AWS.md", 2)

    await client.post("/api/anki", content=MOVED)

    assert _line(vault, "GCP.md", 2).endswith(SR)


async def test_m3_a_card_moved_with_only_its_new_deck_imported_moves_with_its_schedule(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    _rate(vault, "AWS.md", 2)

    response = await client.post("/api/anki", content=MOVED_GCP)

    assert (response.status_code, _holding(vault, 2), _holding(vault, 1)) == (
        201,
        ["GCP.md"],
        ["AWS.md"],
    )
    assert _line(vault, "GCP.md", 2).endswith(SR)


async def test_m4_a_moved_card_edited_in_kasten_keeps_the_edit_and_schedule(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    _rate(vault, "AWS.md", 2, edit=", mine")

    await client.post("/api/anki", content=MOVED_GCP)

    line = _line(vault, "GCP.md", 2)
    assert (line.startswith("c::d, mine <!--anki:2:0:"), line.endswith(SR)) == (True, True)


async def test_m5_a_card_deleted_in_anki_stays_in_its_note_counted_removed(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    gone = apkg(
        notes=((1, BASIC, "a\x1fb"), (3, BASIC, "e\x1ff")),
        cards=((1, 1, 10, 0), (3, 3, 20, 0)),
        decks=((10, "AWS"), (20, "GCP")),
    )

    response = await client.post("/api/anki", content=gone)

    assert (response.json()["removed"], _holding(vault, 2)) == (1, ["AWS.md"])


async def test_m6_a_card_in_no_decks_own_note_is_refused_with_advice_to_move_its_lines(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    _split_out(vault, 2, "03 Flashcards/Mine.md")
    mine = vault / "03 Flashcards" / "Mine.md"
    other = "x::y <!--anki:99:0:deadbeef-->\n"
    mine.write_text(mine.read_text(encoding="utf-8").replace("AWS", "Other") + other)

    response = await client.post("/api/anki", content=MOVED_GCP)

    assert (response.status_code, "Join" in response.text) == (409, False)
    assert "Move each card's lines into 03 Flashcards/GCP.md" in response.text


async def test_m7_a_card_in_two_notes_is_refused_with_advice_to_move_its_lines(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    folder = vault / "03 Flashcards"
    (folder / "Old.md").write_text(f"#flashcards/Old\n\n{_line(vault, 'AWS.md', 2)}\n")

    response = await client.post("/api/anki", content=MOVED_GCP)

    assert (response.status_code, "Move each card's lines" in response.text) == (409, True)


async def test_m8_the_old_note_keeps_every_other_line_byte_for_byte(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    aws = vault / "03 Flashcards" / "AWS.md"
    aws.write_text(aws.read_text(encoding="utf-8") + "\nMy prose.\n", encoding="utf-8")
    before = aws.read_text(encoding="utf-8").replace(_line(vault, "AWS.md", 2) + "\n", "")

    await client.post("/api/anki", content=MOVED_GCP)

    after = aws.read_text(encoding="utf-8")
    assert after.split("\n---\n", 1)[1] == before.split("\n---\n", 1)[1]


async def test_m9_a_new_decks_note_is_made_holding_the_moved_card_and_its_schedule(
    client: AsyncClient, vault: Path
) -> None:
    aws_only = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0)),
        decks=((10, "AWS"),),
    )
    await client.post("/api/anki", content=aws_only)
    _rate(vault, "AWS.md", 2)

    response = await client.post("/api/anki", content=MOVED_GCP)

    counts = {key: response.json()[key] for key in ("added", "kept", "removed")}
    assert (counts, _holding(vault, 2), _holding(vault, 3)) == (
        {"added": 1, "kept": 1, "removed": 0},
        ["GCP.md"],
        ["GCP.md"],
    )
    assert _line(vault, "GCP.md", 2).endswith(SR)


async def test_m10_a_moved_question_card_moves_whole_with_its_schedule_line(
    client: AsyncClient, vault: Path
) -> None:
    question = (2, BASIC, "q::r\x1fd")
    await client.post(
        "/api/anki",
        content=apkg(
            notes=((1, BASIC, "a\x1fb"), question, (3, BASIC, "e\x1ff")),
            cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 20, 0)),
            decks=((10, "AWS"), (20, "GCP")),
        ),
    )
    _rate(vault, "AWS.md", 2)
    aws = vault / "03 Flashcards" / "AWS.md"
    card = aws.read_text(encoding="utf-8").split("\n\n")[-1].strip()

    await client.post(
        "/api/anki",
        content=apkg(
            notes=(question, (3, BASIC, "e\x1ff")),
            cards=((2, 2, 20, 0), (3, 3, 20, 0)),
            decks=((20, "GCP"),),
        ),
    )

    gcp = (vault / "03 Flashcards" / "GCP.md").read_text(encoding="utf-8")
    left = aws.read_text(encoding="utf-8")
    assert (card in gcp, "q::r" in left, "\n\n\n" in left, left.endswith("\n\n")) == (
        True,
        False,
        False,
        False,
    )


async def test_m11_a_question_card_edited_over_its_lines_is_refused_not_split(
    client: AsyncClient, vault: Path
) -> None:
    question = (2, BASIC, "q::r\x1fd")
    await client.post(
        "/api/anki",
        content=apkg(
            notes=((1, BASIC, "a\x1fb"), question, (3, BASIC, "e\x1ff")),
            cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 20, 0)),
            decks=((10, "AWS"), (20, "GCP")),
        ),
    )
    _rate(vault, "AWS.md", 2, edit=" mine")
    aws = vault / "03 Flashcards" / "AWS.md"
    before = aws.read_bytes()

    response = await client.post(
        "/api/anki",
        content=apkg(
            notes=(question, (3, BASIC, "e\x1ff")),
            cards=((2, 2, 20, 0), (3, 3, 20, 0)),
            decks=((20, "GCP"),),
        ),
    )

    assert (response.status_code, "Move each card's lines" in response.text) == (409, True)
    assert aws.read_bytes() == before


async def test_m12_a_card_moved_and_changed_in_anki_takes_the_new_text_and_keeps_its_schedule(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    _rate(vault, "AWS.md", 2)
    changed = apkg(
        notes=((2, BASIC, "c\x1fD"), (3, BASIC, "e\x1ff")),
        cards=((2, 2, 20, 0), (3, 3, 20, 0)),
        decks=((20, "GCP"),),
    )

    await client.post("/api/anki", content=changed)

    line = _line(vault, "GCP.md", 2)
    assert (line.startswith("c::D <!--anki:2:0:"), line.endswith(SR)) == (True, True)


async def test_m13_a_moved_card_is_counted_kept_not_removed(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)

    response = await client.post("/api/anki", content=MOVED)

    counts = {key: response.json()[key] for key in ("added", "kept", "removed")}
    assert counts == {"added": 0, "kept": 3, "removed": 0}


async def test_m14_an_old_note_in_crlf_stays_crlf_throughout(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    aws = vault / "03 Flashcards" / "AWS.md"
    aws.write_bytes(aws.read_bytes().replace(b"\n", b"\r\n"))

    await client.post("/api/anki", content=MOVED_GCP)

    after = aws.read_bytes()
    assert (after.count(b"\n"), b"<!--anki:2:0:" in after) == (after.count(b"\r\n"), False)


async def test_m15_a_deck_renamed_in_anki_moves_its_cards_to_the_new_names_note(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    _rate(vault, "AWS.md", 2)
    renamed = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0)),
        decks=((10, "Cloud"),),
    )

    response = await client.post("/api/anki", content=renamed)

    assert (response.status_code, _holding(vault, 1), _holding(vault, 2)) == (
        201,
        ["Cloud.md"],
        ["Cloud.md"],
    )
    assert _line(vault, "Cloud.md", 2).endswith(SR)


async def test_m16_a_moved_deck_note_under_another_tag_still_gets_the_join_advice(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    folder = vault / "03 Flashcards"
    (folder / "Old").mkdir()
    text = (folder / "AWS.md").read_text(encoding="utf-8")
    (folder / "Old" / "AWS.md").write_text(text.replace("#flashcards/AWS", "#flashcards/A:WS"))
    (folder / "AWS.md").unlink()

    response = await client.post("/api/anki", content=TWO_CARDS)

    assert (response.status_code, "Join those notes" in response.text) == (409, True)


async def test_m17_an_unchanged_note_with_no_final_newline_is_not_rewritten(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=TWO_CARDS)
    aws = vault / "03 Flashcards" / "AWS.md"
    aws.write_bytes(aws.read_bytes().rstrip(b"\n"))
    before = aws.read_bytes()

    await client.post("/api/anki", content=TWO_CARDS)

    assert aws.read_bytes() == before


async def test_m18_an_edited_question_card_anki_made_one_line_is_refused_not_split(
    client: AsyncClient, vault: Path
) -> None:
    await client.post(
        "/api/anki",
        content=apkg(
            notes=((1, BASIC, "a\x1fb"), (2, BASIC, "q::r\x1fd"), (3, BASIC, "e\x1ff")),
            cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 20, 0)),
            decks=((10, "AWS"), (20, "GCP")),
        ),
    )
    _rate(vault, "AWS.md", 2, edit=" mine")
    aws = vault / "03 Flashcards" / "AWS.md"
    before = aws.read_bytes()

    response = await client.post(
        "/api/anki",
        content=apkg(
            notes=((2, BASIC, "qr\x1fd"), (3, BASIC, "e\x1ff")),
            cards=((2, 2, 20, 0), (3, 3, 20, 0)),
            decks=((20, "GCP"),),
        ),
    )

    assert (response.status_code, aws.read_bytes()) == (409, before)


async def test_m19_an_old_note_that_is_not_utf8_is_refused_and_kept_byte_for_byte(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=AWS_GCP)
    aws = vault / "03 Flashcards" / "AWS.md"
    aws.write_bytes(aws.read_bytes() + b"caf\xe9\n")
    before = aws.read_bytes()

    response = await client.post("/api/anki", content=MOVED_GCP)

    assert (response.status_code, aws.read_bytes()) == (409, before)
    assert "not UTF-8" in response.text
