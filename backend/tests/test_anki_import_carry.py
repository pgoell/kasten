from typing import TYPE_CHECKING

import pytest

from backend.tests.anki_build import BASIC, CLOZE, NO_ROW, apkg, mark, unhashed
from kasten_backend.anki import read_apkg
from kasten_backend.anki_note import as_note

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def reviewed(deck: str, *, more: bool = False) -> bytes:
    """An export of one deck whose cards Anki has in review, `more` adding one to it."""
    notes = (
        (1, BASIC, "a\x1fb"),
        (2, BASIC, "What is a::b?\x1fc"),
        (3, CLOZE, "{{c1::H}} {{c2::O}} {{c3::N}}\x1f"),
    )
    cards = ((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 10, 0), (4, 3, 10, 1), (5, 3, 10, 2))
    reviews = ((1, 2, 4, 2500, 10), (2, 2, 9, 2300, 20), (3, 2, 3, 2500, 5), (5, 2, 7, 2700, 6))
    if more:
        notes += ((4, BASIC, "d\x1fe"),)
        cards += ((6, 4, 10, 0),)
        reviews += ((6, 2, 1, 2500, 2),)
    return apkg(notes, cards, ((10, deck),), reviews=reviews)


async def test_carry_writes_anki_schedules_and_is_off_by_default(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=reviewed("Off"))
    await client.post("/api/anki", params={"carry": "true"}, content=reviewed("Off", more=True))
    await client.post("/api/anki", params={"carry": "true"}, content=reviewed("On"))

    folder = vault / "03 Flashcards"
    off = unhashed((folder / "Off.md").read_text(encoding="utf-8"))
    on = unhashed((folder / "On.md").read_text(encoding="utf-8"))
    # A card already in the note keeps the schedule kasten gave it, none here;
    # only the one the merge added takes Anki's.
    assert off.count("<!--SR:") == 1
    assert f"\nd::e{mark(4)} <!--SR:!2026-01-03,1,250-->\n" in off
    assert on.endswith(
        f"a::b{mark(1)} <!--SR:!2026-01-11,4,250-->\n\n"
        f"What is a:&#58;b?\n?\nc{mark(2)}\n<!--SR:!2026-01-21,9,230-->\n\n"
        f"{{{{c1::H}}}} {{{{c2::O}}}} {{{{c3::N}}}}{mark(3)}"
        " <!--SR:c1!2026-01-06,3,250--> <!--SR:c3!2026-01-07,7,270-->\n"
    )


def test_carry_writes_nothing_for_a_card_new_learning_or_relearning() -> None:
    notes = tuple((nid, BASIC, f"q{nid}\x1fa") for nid in (1, 2, 3, 4))
    cards = tuple((nid, nid, 10, 0) for nid in (1, 2, 3, 4))
    reviews = tuple((nid, kind, 4, 2500, 10) for nid, kind in ((1, 0), (2, 1), (3, 3), (4, 2)))

    deck = read_apkg(apkg(notes, cards, ((10, "x"),), reviews=reviews), carry=True)[0]

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\nq1::a{mark(1)}\nq2::a{mark(2)}\nq3::a{mark(3)}\n"
        f"q4::a{mark(4)} <!--SR:!2026-01-11,4,250-->\n"
    )


@pytest.mark.parametrize("crt", [NO_ROW, None, "soon", 1.5], ids=["no-row", "null", "text", "real"])
async def test_carry_refuses_an_export_whose_creation_time_it_cannot_read(
    client: AsyncClient, vault: Path, crt: object
) -> None:
    export = apkg(schema18=True, reviews=((11, 2, 4, 2500, 10),), crt=crt)

    response = await client.post("/api/anki", params={"carry": "true"}, content=export)

    assert response.status_code == 400
    assert "unreadable" in response.json()["detail"]
    assert not (vault / "03 Flashcards").exists()
