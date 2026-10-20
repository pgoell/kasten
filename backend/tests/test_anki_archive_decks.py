from backend.tests.anki_build import CARDS, EXPECTED, apkg, sides
from kasten_backend.anki import read_apkg


def test_spells_a_nested_deck_with_a_slash_on_schema_18() -> None:
    data = apkg(decks=((100, "Certs\x1fAWS"), (200, "Geography")), schema18=True)

    assert read_apkg(data)[0].name == "Certs/AWS"


def test_spells_a_nested_deck_with_a_slash_on_the_old_schema() -> None:
    data = apkg(decks=((100, "Certs::AWS"), (200, "Geography")))

    assert read_apkg(data)[0].name == "Certs/AWS"


def test_skips_a_note_no_card_points_at() -> None:
    data = apkg(cards=CARDS[1:])

    assert sides(read_apkg(data)) == {"Geography": EXPECTED["Geography"]}
