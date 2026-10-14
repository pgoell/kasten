"""What a move does to the links that named the notes it moved."""

import json
import time
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend.links import FILE_SUFFIXES, code_spans, link_path, relink, split_target
from kasten_backend.search import SearchError, notes_holding

if TYPE_CHECKING:
    from httpx import AsyncClient

LINK_PATHS = json.loads((Path(__file__).parent / "link_paths.json").read_text())
"""The cases `wikiLinkPath` in the frontend is tested against too, so the two copies agree."""

BOOK = b"%PDF-1.7 not really a book"


async def test_follows_a_link_that_spelled_out_the_path(client: AsyncClient, vault: Path) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("see [[reading/borges]]\n")

    await client.patch("/api/files/reading/borges.md", json={"path": "archive/borges.md"})

    assert (vault / "index.md").read_text() == "see [[archive/borges]]\n"


async def test_follows_a_link_that_named_the_note(client: AsyncClient, vault: Path) -> None:
    (vault / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("see [[borges]]\n")

    await client.patch("/api/files/borges.md", json={"path": "kafka.md"})

    assert (vault / "index.md").read_text() == "see [[kafka]]\n"


async def test_leaves_a_bare_name_alone_when_only_the_folder_changed(
    client: AsyncClient, vault: Path
) -> None:
    # A name follows the note on its own, so a move between folders is nothing
    # for it to answer. The rewrite has to arrive at the same text rather than
    # at a path spelling nobody asked for.
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("see [[borges]]\n")

    await client.patch("/api/files/reading/borges.md", json={"path": "archive/borges.md"})

    assert (vault / "index.md").read_text() == "see [[borges]]\n"


async def test_leaves_a_link_to_another_note_alone(client: AsyncClient, vault: Path) -> None:
    (vault / "borges.md").write_text("# borges")
    (vault / "kafka.md").write_text("# kafka")
    (vault / "index.md").write_text("see [[kafka]]\n")

    await client.patch("/api/files/borges.md", json={"path": "cortazar.md"})

    assert (vault / "index.md").read_text() == "see [[kafka]]\n"


async def test_leaves_the_name_alone_in_prose(client: AsyncClient, vault: Path) -> None:
    (vault / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("borges wrote the library\n")

    await client.patch("/api/files/borges.md", json={"path": "kafka.md"})

    assert (vault / "index.md").read_text() == "borges wrote the library\n"


async def test_follows_the_note_s_own_links_to_itself(client: AsyncClient, vault: Path) -> None:
    (vault / "borges.md").write_text("# borges\n\nback to [[borges]]\n")

    response = await client.patch("/api/files/borges.md", json={"path": "kafka.md"})

    assert (vault / "kafka.md").read_text() == "# borges\n\nback to [[kafka]]\n"
    # The answer is read off disk after the move, so what comes back is the
    # note the editor is about to reopen rather than the text it sent.
    assert response.json()["content"] == "# borges\n\nback to [[kafka]]\n"


async def test_follows_every_link_on_a_line(client: AsyncClient, vault: Path) -> None:
    (vault / "borges.md").write_text("# borges")
    (vault / "kafka.md").write_text("# kafka")
    (vault / "index.md").write_text("[[borges]] and [[kafka]] and [[borges]]\n")

    await client.patch("/api/files/borges.md", json={"path": "cortazar.md"})

    assert (vault / "index.md").read_text() == "[[cortazar]] and [[kafka]] and [[cortazar]]\n"


async def test_leaves_a_link_the_vault_answers_elsewhere_alone(
    client: AsyncClient, vault: Path
) -> None:
    # A bare name is looked for anywhere, and the note at the root wins. So
    # `[[borges]]` never named the one in `reading/`, and moving that one is
    # nothing for the link to answer.
    (vault / "borges.md").write_text("# borges")
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# the other borges")
    (vault / "index.md").write_text("see [[borges]]\n")

    await client.patch("/api/files/reading/borges.md", json={"path": "archive/borges.md"})

    assert (vault / "index.md").read_text() == "see [[borges]]\n"


async def test_leaves_a_link_that_runs_past_its_line_alone(
    client: AsyncClient, vault: Path
) -> None:
    # The editor's parser refuses one, so nothing here may call it a link.
    (vault / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("[[borges\nborges]]\n")

    await client.patch("/api/files/borges.md", json={"path": "kafka.md"})

    assert (vault / "index.md").read_text() == "[[borges\nborges]]\n"


async def test_follows_a_folder_that_moved(client: AsyncClient, vault: Path) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("see [[reading/borges]]\n")

    await client.patch("/api/folders/reading", json={"path": "archive"})

    assert (vault / "index.md").read_text() == "see [[archive/borges]]\n"


async def test_follows_a_note_deeper_in_the_subtree(client: AsyncClient, vault: Path) -> None:
    (vault / "reading" / "2026").mkdir(parents=True)
    (vault / "reading" / "2026" / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("see [[reading/2026/borges]]\n")

    await client.patch("/api/folders/reading", json={"path": "archive/old"})

    assert (vault / "index.md").read_text() == "see [[archive/old/2026/borges]]\n"


async def test_follows_a_link_between_two_notes_that_moved_together(
    client: AsyncClient, vault: Path
) -> None:
    # The subtree's own links are the ones a folder move would otherwise leave
    # pointing at a folder that is no longer there.
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges\n\nsee [[reading/kafka]]\n")
    (vault / "reading" / "kafka.md").write_text("# kafka")

    await client.patch("/api/folders/reading", json={"path": "archive"})

    assert (vault / "archive" / "borges.md").read_text() == "# borges\n\nsee [[archive/kafka]]\n"


async def test_follows_a_page_in_a_folder_that_moved(client: AsyncClient, vault: Path) -> None:
    (vault / "news").mkdir()
    (vault / "news" / "2026-10-07.html").write_text("<p>news</p>")
    (vault / "index.md").write_text("see [[news/2026-10-07.html]] and [[2026-10-07.html]]\n")

    await client.patch("/api/folders/news", json={"path": "archive/news"})

    assert (vault / "index.md").read_text() == (
        "see [[archive/news/2026-10-07.html]] and [[2026-10-07.html]]\n"
    )
    assert (vault / "archive" / "news" / "2026-10-07.html").read_text() == "<p>news</p>"


async def test_leaves_a_bare_name_alone_when_a_folder_moves(
    client: AsyncClient, vault: Path
) -> None:
    # A name follows the note on its own, and the names are what a folder move
    # leaves untouched.
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("see [[borges]]\n")

    await client.patch("/api/folders/reading", json={"path": "archive"})

    assert (vault / "index.md").read_text() == "see [[borges]]\n"


async def test_leaves_a_link_to_a_note_outside_the_folder_alone(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "readings.md").write_text("# readings")
    # `readings.md` starts with the folder's name and is not under it, which is
    # the prefix match a folder move must not make.
    (vault / "index.md").write_text("see [[readings]]\n")

    await client.patch("/api/folders/reading", json={"path": "archive"})

    assert (vault / "index.md").read_text() == "see [[readings]]\n"


async def test_writes_the_links_before_the_folder_moves(client: AsyncClient, vault: Path) -> None:
    # The note holding the link is itself inside the folder, so a rewrite that
    # ran after the rename would be writing to a path that is no longer there.
    (vault / "reading").mkdir()
    (vault / "reading" / "index.md").write_text("see [[reading/borges]]\n")
    (vault / "reading" / "borges.md").write_text("# borges")

    response = await client.patch("/api/folders/reading", json={"path": "archive"})

    assert response.status_code == 200
    assert (vault / "archive" / "index.md").read_text() == "see [[archive/borges]]\n"


async def test_follows_a_link_written_in_another_case(client: AsyncClient, vault: Path) -> None:
    # A bare name is resolved ignoring case, so the read that narrows the
    # rewrite has to ignore it too or this link is never looked at.
    (vault / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("see [[Borges]]\n")

    await client.patch("/api/files/borges.md", json={"path": "kafka.md"})

    assert (vault / "index.md").read_text() == "see [[kafka]]\n"


async def test_follows_a_link_to_a_heading_or_under_an_alias(
    client: AsyncClient, vault: Path
) -> None:
    # The name is respelled and what follows it is the writer's, kept as typed.
    (vault / "borges.md").write_text("# borges")
    (vault / "index.md").write_text(
        "[[borges#Ficciones]] [[borges|the librarian]] ![[borges#Ficciones]]"
        " ![[borges|the librarian]] [[borges#Ficciones|his stories]]\n"
    )

    await client.patch("/api/files/borges.md", json={"path": "kafka.md"})

    assert (vault / "index.md").read_text() == (
        "[[kafka#Ficciones]] [[kafka|the librarian]] ![[kafka#Ficciones]]"
        " ![[kafka|the librarian]] [[kafka#Ficciones|his stories]]\n"
    )


async def test_follows_a_link_in_a_table_cell_with_its_bar_escaped(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("| who |\n| --- |\n| [[borges\\|the librarian]] |\n")

    await client.patch("/api/files/borges.md", json={"path": "kafka.md"})

    assert (vault / "index.md").read_text() == "| who |\n| --- |\n| [[kafka\\|the librarian]] |\n"


async def test_follows_a_path_to_a_heading_when_the_note_moves(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("[[reading/borges#Ficciones|his stories]]\n")

    await client.patch("/api/files/reading/borges.md", json={"path": "archive/borges.md"})

    assert (vault / "index.md").read_text() == "[[archive/borges#Ficciones|his stories]]\n"


async def test_follows_a_path_to_a_heading_when_the_folder_moves(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("[[reading/borges#Ficciones]] ![[reading/borges|his]]\n")

    await client.patch("/api/folders/reading", json={"path": "archive"})

    assert (vault / "index.md").read_text() == (
        "[[archive/borges#Ficciones]] ![[archive/borges|his]]\n"
    )


async def test_keeps_a_name_a_name_when_its_alias_holds_a_slash(
    client: AsyncClient, vault: Path
) -> None:
    # The slash is in the alias, so the link was written as a name and stays
    # one: a move between folders is nothing for it to answer.
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "index.md").write_text("see [[borges|and/or]]\n")

    await client.patch("/api/files/reading/borges.md", json={"path": "archive/kafka.md"})

    assert (vault / "index.md").read_text() == "see [[kafka|and/or]]\n"


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


async def test_follows_an_asset_in_a_folder_that_moved(client: AsyncClient, vault: Path) -> None:
    (vault / "rehearse").mkdir()
    (vault / "rehearse" / "plan.pdf").write_bytes(BOOK)
    (vault / "index.md").write_text(
        "[[rehearse/plan.pdf]] ![[rehearse/plan.pdf]] [[rehearse/plan.pdf|Plan]]"
        " [[rehearse/plan.pdf#page=2]] [[plan.pdf]]\n"
    )

    await client.patch("/api/folders/rehearse", json={"path": "elsewhere"})

    assert (vault / "index.md").read_text() == (
        "[[elsewhere/plan.pdf]] ![[elsewhere/plan.pdf]] [[elsewhere/plan.pdf|Plan]]"
        " [[elsewhere/plan.pdf#page=2]] [[plan.pdf]]\n"
    )
    assert (vault / "elsewhere" / "plan.pdf").read_bytes() == BOOK


async def test_follows_the_book_a_moved_note_carries(client: AsyncClient, vault: Path) -> None:
    (vault / "a").mkdir()
    (vault / "a" / "x.md").write_text("# x")
    (vault / "a" / "x.pdf").write_bytes(BOOK)
    (vault / "index.md").write_text("[[a/x.pdf]] ![[a/x.pdf|the book]]\n")

    await client.patch("/api/files/a/x.md", json={"path": "b/x.md"})

    assert (vault / "index.md").read_text() == "[[b/x.pdf]] ![[b/x.pdf|the book]]\n"
    assert (vault / "b" / "x.pdf").read_bytes() == BOOK


async def test_follows_the_book_a_renamed_note_carries_by_its_name(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "x.md").write_text("# x")
    (vault / "x.pdf").write_bytes(BOOK)
    (vault / "index.md").write_text("[[x.pdf]] [[x]]\n")

    await client.patch("/api/files/x.md", json={"path": "y.md"})

    assert (vault / "index.md").read_text() == "[[y.pdf]] [[y]]\n"
    assert (vault / "y.pdf").read_bytes() == BOOK


async def test_leaves_the_links_of_a_book_held_back(client: AsyncClient, vault: Path) -> None:
    # The landing is taken, so the book stays where it is, and so do the links
    # to it: rewriting them would point them at the other book.
    (vault / "a").mkdir()
    (vault / "b").mkdir()
    (vault / "a" / "x.md").write_text("# x")
    (vault / "a" / "x.pdf").write_bytes(BOOK)
    (vault / "b" / "x.pdf").write_bytes(b"%PDF-1.7 another book")
    (vault / "index.md").write_text("[[a/x.pdf]] [[a/x]]\n")

    await client.patch("/api/files/a/x.md", json={"path": "b/x.md"})

    assert (vault / "index.md").read_text() == "[[a/x.pdf]] [[b/x]]\n"
    assert (vault / "a" / "x.pdf").read_bytes() == BOOK


@pytest.mark.parametrize(
    ("source", "target"),
    [("a/x.md", "b/x.md"), ("a", "c")],
)
async def test_previews_the_files_a_move_with_assets_writes(
    client: AsyncClient, vault: Path, source: str, target: str
) -> None:
    (vault / "a").mkdir()
    (vault / "a" / "x.md").write_text("# x")
    (vault / "a" / "x.pdf").write_bytes(BOOK)
    (vault / "a" / "shot.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (vault / "book.md").write_text("[[a/x.pdf]]\n")
    (vault / "shot.md").write_text("![[a/shot.png]]\n")
    (vault / "none.md").write_text("[[x.pdf]]\n")
    notes = ["a/x.md", "book.md", "shot.md", "none.md"]
    before = {name: (vault / name).read_text() for name in notes}

    response = await client.get("/api/move-preview", params={"source": source, "target": target})
    route = "/api/files/" if source.endswith(".md") else "/api/folders/"
    await client.patch(f"{route}{source}", json={"path": target})

    # `a/x.md` has moved and holds no link, so a file missing now wrote nothing.
    written = sorted(
        name
        for name, text in before.items()
        if (vault / name).exists() and (vault / name).read_text() != text
    )
    assert response.json()["rewrites"] == written
    assert written == (["book.md"] if source == "a/x.md" else ["book.md", "shot.md"])


@pytest.mark.parametrize(
    "text",
    [
        "```\n[[x]]\n```\n",
        "```md\nsee [[x]] and [[a/x]]\n```\n",
        "~~~\n[[x]]\n~~~\n",
        "   ```\n[[x]]\n   ```\n",
        "````\n```\n[[x]]\n````\n",
        "~~~\n```\n[[x]]\n~~~\n",
        "```\n[[x]]\n",
        "inline `[[x]]` here\n",
        "inline ``a ` [[x]]`` here\n",
        "```\n[t](a/x.md)\n```\n",
        "`[t](a/x.md)`\n",
    ],
)
async def test_leaves_a_link_in_code_as_written(
    client: AsyncClient, vault: Path, text: str
) -> None:
    # Code holds the syntax as an example, so neither a move nor a rename is
    # anything for it to answer.
    (vault / "a").mkdir()
    (vault / "a" / "x.md").write_text("# x")
    (vault / "index.md").write_text(text)

    await client.patch("/api/files/a/x.md", json={"path": "b/y.md"})

    assert (vault / "index.md").read_text() == text


async def test_follows_a_link_right_after_a_fence(client: AsyncClient, vault: Path) -> None:
    (vault / "x.md").write_text("# x")
    (vault / "index.md").write_text("```\n[[x]]\n```\n[[x]] `[[x]]` [[x]] [t](x.md)\n")

    await client.patch("/api/files/x.md", json={"path": "y.md"})

    expected = "```\n[[x]]\n```\n[[y]] `[[x]]` [[y]] [t](y.md)\n"
    assert (vault / "index.md").read_text() == expected


@pytest.mark.parametrize(
    ("text", "spans"),
    [
        ("a\n    [[x]]\n", []),
        ("```js\nx\n``\n```\n", [(0, 15)]),
        ("```a`b\n[[x]]\n", []),
        ("`a\n\nb `c`", [(6, 9)]),
        ("``a`` `b", [(0, 5)]),
    ],
)
def test_code_spans_reads_code_the_way_commonmark_does(
    text: str, spans: list[tuple[int, int]]
) -> None:
    # An indented line is a list item's continuation as often as it is code,
    # and a backtick fence with a backtick after it is inline code.
    assert code_spans(text) == spans


@pytest.mark.parametrize(
    "text",
    [
        "- use ` for code\n- see [[x]]\n- `y`\n",
        "# a ` b\n[[x]] `c`\n",
        "a ` b\n[[x]] `c`\n",
        "| a ` | b |\n|---|---|\n| [[x]] | `c` |\n",
    ],
)
def test_follows_a_link_between_two_lines_a_backtick_would_pair(text: str) -> None:
    # A span is read on one line only, so a stray backtick in one list item,
    # heading or table row cannot pair with one further down and hide the link.
    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == text.replace("[[x]]", "[[y]]")


def test_follows_a_link_after_an_escaped_backtick() -> None:
    text = "a \\` b [[x]] c `d`\n"

    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == "a \\` b [[y]] c `d`\n"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("[[x|a `b]] and [[x]] then ` end\n", "[[y|a `b]] and [[y]] then ` end\n"),
        ("see [[x|`code`]]\n", "see [[y|`code`]]\n"),
    ],
)
def test_follows_a_link_whose_alias_holds_a_backtick(text: str, expected: str) -> None:
    # A backtick in a link opens no code, so it cannot pair with a later one.
    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == expected


@pytest.mark.parametrize(
    "text",
    [
        "Type `[[` and close with ]] like [[Old]] or `x`\n",
        "Run `x [[Note|a`b]] then [[Old]] and `y`\n",
    ],
)
def test_follows_a_link_after_a_span_that_closes_inside_another(text: str) -> None:
    # The span's closer sits in what reads as a `[[link]]`, and it still closes:
    # skipping it would pair the opener with the last backtick and hide `[[Old]]`.
    assert relink(text, {"Old.md": "New.md"}, ["Old.md"]) == text.replace("[[Old]]", "[[New]]")


@pytest.mark.parametrize(
    ("text", "spans"),
    [
        ("a \\` b `c`", [(7, 10)]),
        ("C:\\\\`[[x]]`", [(4, 11)]),
        ("\\``[[x]]`", [(2, 9)]),
        ("`a\\`", [(0, 4)]),
    ],
)
def test_code_spans_reads_a_backslash_before_a_backtick(
    text: str, spans: list[tuple[int, int]]
) -> None:
    # An odd run of backslashes escapes one backtick of an opener, and the rest
    # of its run may still open. Inside code a backslash escapes nothing.
    assert code_spans(text) == spans


@pytest.mark.parametrize(
    "text",
    [
        "x\x0c```\n[[x]]\n",
        "a\N{LINE SEPARATOR}```\n[[x]]\n",
        "a\x0b```b\n[[x]]\n",
        "a\x85```\n[[x]]\n",
    ],
)
def test_opens_no_fence_after_a_break_that_is_not_a_newline(text: str) -> None:
    # Python's `splitlines` breaks at these, and the fence after one sits mid-line.
    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == text.replace("[[x]]", "[[y]]")


def test_reads_a_fence_with_windows_line_endings() -> None:
    text = "~~~\r\n[[x]]\r\n~~~\r\n[[x]]\r\n"

    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == "~~~\r\n[[x]]\r\n~~~\r\n[[y]]\r\n"


def test_relinks_a_long_note_full_of_code_in_time() -> None:
    # One scan of every span per link held the event loop 27s on this note.
    text = "text `code` [[x]] more\n" * 20000
    began = time.perf_counter()

    relink(text, {"x.md": "y.md"}, ["x.md"])
    code_spans("`a``b" * 20000)

    assert time.perf_counter() - began < 2
