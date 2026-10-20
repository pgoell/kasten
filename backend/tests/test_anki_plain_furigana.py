from backend.tests.anki_build import FURIGANA, FURIGANA_TYPE, TYPES, one_deck


def test_furigana_filters_follow_anki() -> None:
    notes = ((1, FURIGANA, "x\x1f漢字[かんじ]を&nbsp;読[よ]む"),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1), (13, 1, 100, 2))

    assert one_deck(notes, cards, types=(*TYPES, FURIGANA_TYPE)) == [
        ("x", "<ruby>漢字<rt>かんじ</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む"),
        ("漢字を読む", "かんじをよむ"),
        # No filter shows the brackets as stored, which is what Anki shows.
        (r"漢字\[かんじ]を 読\[よ]む", "x"),
    ]


def test_furigana_inside_a_cloze_mark_leaves_the_mark_whole() -> None:
    # Anki fills the furigana in after the cloze, where the mark is a tag and
    # `>` stops the base; read raw, the base would swallow `{{c1::`.
    notes = ((1, FURIGANA, "x\x1f{{c1::漢字[かんじ]}}を"),)

    assert one_deck(notes, ((11, 1, 100, 0),), types=(*TYPES, FURIGANA_TYPE)) == [
        ("x", "==<ruby>漢字<rt>かんじ</rt></ruby>==を")
    ]
