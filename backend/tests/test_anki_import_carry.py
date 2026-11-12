from typing import TYPE_CHECKING

import pytest

from backend.tests.anki_build import BASIC, CLOZE, NO_ROW, apkg, mark, unhashed
from kasten_backend.anki import as_note, merge, read_apkg

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
    folder = vault / "03 Flashcards"
    off = unhashed((folder / "Off.md").read_text(encoding="utf-8"))
    # Since #1138 the same Anki cards in a second deck's note are refused, so Off.md goes first.
    (folder / "Off.md").unlink()
    await client.post("/api/anki", params={"carry": "true"}, content=reviewed("On"))

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


DOC = "<!--SR:!fsrs,2026-11-20T00:00:00.000Z,8,8.30,1.00,2,1,0,0,2026-11-12T00:00:00.000Z-->"
"""The FSRS comment of docs/explanation/spaced-repetition.md, which the frontend's test pins too."""


def fsrs_note(data: str, reps: int = 1, lapses: int = 0, *, cloze: bool = False) -> str:
    """The note one card due 2026-11-20 with an 8-day interval imports to, its `data` as given."""
    note = (1, CLOZE, "{{c1::H}} {{c2::O}}\x1f") if cloze else (1, BASIC, "q\x1fa")
    cards = ((1, 1, 10, 0), (2, 1, 10, 1)) if cloze else ((1, 1, 10, 0),)
    reviews = tuple((card, 2, 8, 2500, 323) for card, *_ in cards)
    rows = tuple((card, reps, lapses, data) for card, *_ in cards)
    export = apkg((note,), cards, ((10, "x"),), reviews=reviews, fsrs=rows)
    return unhashed(as_note(read_apkg(export, carry=True)[0]))


LRT = 1794441600
"""2026-11-12 at midnight UTC, as Anki's `lrt` counts it."""


@pytest.mark.parametrize(
    ("data", "comment"),
    [
        (f'{{"s":8.2956,"d":1.0,"lrt":{LRT}}}', DOC),
        # No last answer: the plugin's rule, the due day less the interval.
        ('{"s":8.2956,"d":1}', DOC),
        (
            '{"s":0.001,"d":5.555,"lrt":1}',
            DOC.replace("8.30,1.00", "0.01,5.55").replace("2026-11-12T", "1970-01-01T"),
        ),
        ("", "<!--SR:!2026-11-20,8,250-->"),
        ("{}", "<!--SR:!2026-11-20,8,250-->"),
        ('{"s":8.3}', "<!--SR:!2026-11-20,8,250-->"),
        ('{"d":1}', "<!--SR:!2026-11-20,8,250-->"),
        ('{"s":true,"d":1}', "<!--SR:!2026-11-20,8,250-->"),
        ('{"s":"8","d":1}', "<!--SR:!2026-11-20,8,250-->"),
        ("[1,2]", "<!--SR:!2026-11-20,8,250-->"),
        ("not json", "<!--SR:!2026-11-20,8,250-->"),
        (f'{{"s":8.2956,"d":1,"lrt":"{LRT}"}}', DOC),
    ],
)
def test_1926_a6_carry_writes_fsrs_where_anki_has_s_and_d(data: str, comment: str) -> None:
    assert fsrs_note(data) == f"#flashcards/x\n\nq::a{mark(1)} {comment}\n"


def test_1926_a6_carry_writes_reps_lapses_and_each_cloze_number() -> None:
    note = fsrs_note(f'{{"s":8.2956,"d":1.0,"lrt":{LRT}}}', reps=7, lapses=2, cloze=True)
    own = DOC.replace(",2,1,0,0,", ",2,7,2,0,")
    assert note.endswith(
        f"{mark(1)} {own.replace('SR:!', 'SR:c1!')} {own.replace('SR:!', 'SR:c2!')}\n"
    )


def test_1926_a7_a_re_import_keeps_the_fsrs_comment_a_rating_wrote() -> None:
    first = as_note(
        read_apkg(
            apkg(
                ((1, BASIC, "q\x1fa"), (2, BASIC, "r\x1fb")),
                ((1, 1, 10, 0), (2, 2, 10, 0)),
                ((10, "x"),),
            )
        )[0]
    )
    # A rating put the FSRS comment on q's line, and an older tab an SM-2 one on r's beside one.
    tails = {"q::a": f" {DOC}", "r::b": f" {DOC} <!--SR:!2026-11-13,1,250-->"}
    rated = "\n".join(line + tails.get(line[:4], "") for line in first.split("\n"))
    again = apkg(
        ((1, BASIC, "q\x1fa2"), (2, BASIC, "r\x1fb")), ((1, 1, 10, 0), (2, 2, 10, 0)), ((10, "x"),)
    )

    merged = merge(rated, read_apkg(again)[0])

    assert merged is not None
    assert unhashed(merged.text) == (
        f"#flashcards/x\n\nq::a2{mark(1)} {DOC}\nr::b{mark(2)} {DOC} <!--SR:!2026-11-13,1,250-->\n"
    )
    assert (merged.added, merged.updated, merged.kept) == (0, 1, 1)
