"""The rules `pieces.split_note` follows, one test each, with a whitespace tokenizer."""

import re
from itertools import pairwise

from kasten_backend.pieces.split import Piece, split_note, title_of


def words(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]


def test_frontmatter_is_not_indexed():
    content = "---\ntitle: Geheim\nid: 0190\n---\n# Kapitel\n\nText hier\n"
    assert split_note("a.md", content, words) == [Piece("Kapitel", "a > Kapitel\n\nText hier")]


def test_heading_inside_code_fence_is_not_a_heading():
    content = "# Echt\n\n```\n# nur Code\n```\n"
    pieces = split_note("a.md", content, words)
    assert [p.heading for p in pieces] == ["Echt"]
    assert "# nur Code" in pieces[0].text


def test_heading_path_drops_deeper_levels():
    content = "# A\n\na\n\n## B\n\nb\n\n### C\n\nc\n\n## D\n\nd\n"
    pieces = split_note("n.md", content, words)
    assert [p.heading for p in pieces] == ["A", "A > B", "A > B > C", "A > D"]


def test_blank_section_gives_no_piece():
    content = "# A\n\n# B\n\ntext\n"
    assert [p.heading for p in split_note("n.md", content, words)] == ["B"]


def test_long_section_splits_with_overlap():
    body = " ".join(f"w{i}" for i in range(25))
    pieces = split_note("n.md", body, words, size=10, overlap=3)
    chunks = [p.text.split("\n\n", 1)[1].split() for p in pieces]
    assert len(chunks) == 4
    assert all(len(chunk) <= 10 for chunk in chunks)
    assert chunks[-1][-1] == "w24"
    for before, after in pairwise(chunks):
        assert before[-3:] == after[:3]


def test_prefix_carries_title_and_heading_path():
    content = "# Einkommen\n\n## Werbung\n\nKosten 120 EUR\n"
    pieces = split_note("a/b/Steuer 2025.md", content, words)
    assert pieces == [
        Piece("Einkommen > Werbung", "Steuer 2025 > Einkommen > Werbung\n\nKosten 120 EUR")
    ]
    assert title_of("a/b/Steuer 2025.md") == "Steuer 2025"


def test_empty_note_gives_no_pieces():
    assert split_note("a.md", "", words) == []
    assert split_note("a.md", "---\nid: x\n---\n", words) == []
    assert split_note("a.md", "  \n\n", words) == []


def test_text_before_first_heading():
    content = "Intro\n\n# Kopf\n\nKörper\n"
    assert split_note("n.md", content, words) == [
        Piece("", "n\n\nIntro"),
        Piece("Kopf", "n > Kopf\n\nKörper"),
    ]


def test_same_input_same_pieces():
    content = "# A\n\n" + " ".join(f"w{i}" for i in range(40)) + "\n\n## B\n\nx\n"
    first = split_note("n.md", content, words, size=10, overlap=3)
    assert first == split_note("n.md", content, words, size=10, overlap=3)
