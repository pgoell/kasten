import json
from pathlib import Path

import pytest

from kasten_backend.links import FILE_SUFFIXES, link_path, relink, split_target
from kasten_backend.search import SearchError, notes_holding

LINK_PATHS = json.loads((Path(__file__).parent / "link_paths.json").read_text())
"""The cases `wikiLinkPath` in the frontend is tested against too, so the two copies agree."""


@pytest.mark.parametrize(
    ("target", "expected"),
    [
        ("borges#Ficciones", "reading/borges.md"),
        ("borges|the librarian", "reading/borges.md"),
        (" Borges #Ficciones | his stories", "reading/borges.md"),
        ("reading/borges#Ficciones", "reading/borges.md"),
        ("borges|and/or", "reading/borges.md"),
        ("borges|a#b", "reading/borges.md"),
    ],
)
def test_link_path_reads_the_name_past_a_heading_and_an_alias(target: str, expected: str) -> None:
    assert link_path(target, ["reading/borges.md"]) == expected


@pytest.mark.parametrize(
    ("target", "expected"),
    [
        ("borges", ("borges", None, None)),
        (" borges #Ficciones ", ("borges", "Ficciones", None)),
        ("borges#Ficciones|his stories", ("borges", "Ficciones", "his stories")),
        ("borges|a#b/c", ("borges", None, "a#b/c")),
        ("#Ficciones", ("", "Ficciones", None)),
        ("borges#|", ("borges", None, None)),
        ("borges\\|his", ("borges", None, "his")),
    ],
)
def test_split_target_takes_the_bar_before_the_hash(
    target: str, expected: tuple[str, str | None, str | None]
) -> None:
    assert split_target(target) == expected


@pytest.mark.parametrize(
    ("target", "expected"),
    [
        ("report.html", "report.html"),
        ("report.html|x", "report.html"),
        ("plan.pdf", "plan.pdf"),
        ("Plan.PDF", "plan.pdf"),
        ("docs/plan.pdf", "docs/plan.pdf"),
        ("photo.png", "photo.png"),
        ("plan", "plan.md"),
    ],
)
def test_link_path_reads_a_file_link_as_that_file(target: str, expected: str) -> None:
    assert link_path(target, ["plan.pdf", "report.html"]) == expected


def test_follows_a_moved_note_past_links_to_files() -> None:
    text = "[[x]] [[x#H]] [[x|y]] ![[x#H]] [[plan.pdf]] [[report.html]]\n"
    paths = ["plan.pdf", "report.html", "x.md"]

    assert relink(text, {"x.md": "z.md"}, paths) == (
        "[[z]] [[z#H]] [[z|y]] ![[z#H]] [[plan.pdf]] [[report.html]]\n"
    )


def test_leaves_a_link_to_a_heading_of_its_own_note_alone() -> None:
    # `[[#Ficciones]]` names no other note, so no move is anything for it to
    # answer, even one of a file at the path an empty name would make.
    text = "see [[#Ficciones]] and [[ #Ficciones|here]]\n"

    assert relink(text, {".md": "kafka.md"}, [".md", "kafka.md"]) == text


async def test_refuses_to_move_a_note_it_cannot_read_the_vault_for(
    missing_vault: Path,
) -> None:
    # A rewrite that came up short would leave a link pointing at nothing, so
    # rg failing has to be an error here and not an empty answer.
    with pytest.raises(SearchError):
        await notes_holding(missing_vault, "borges")


def test_reads_a_file_by_the_suffixes_the_shared_table_names() -> None:
    assert set(FILE_SUFFIXES) == set(LINK_PATHS["suffixes"])


@pytest.mark.parametrize("case", LINK_PATHS["cases"], ids=lambda case: case["target"])
def test_link_path_answers_the_shared_table(case: dict[str, str]) -> None:
    assert link_path(case["target"], LINK_PATHS["paths"]) == case["path"]
