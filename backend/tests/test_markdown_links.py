from typing import TYPE_CHECKING

from kasten_backend.links import relink_markdown

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def test_follows_a_link_to_a_note_that_moved() -> None:
    text = "* [Borges](borges.md) - the reader"

    assert (
        relink_markdown(text, "index.md", "index.md", "borges.md", "reading/borges.md")
        == "* [Borges](reading/borges.md) - the reader"
    )


def test_follows_the_file_holding_the_link() -> None:
    # The target stays and the note moves, so the same link now has to climb.
    text = "see [x](other.md)"

    assert relink_markdown(text, "a/note.md", "a/b/note.md", "a/note.md", "a/b/note.md") == (
        "see [x](../other.md)"
    )


def test_follows_a_folder_and_keeps_its_slash() -> None:
    text = "* [Reading List](Reading%20List/)"

    assert relink_markdown(text, "index.md", "index.md", "Reading List", "Books/Reading List") == (
        "* [Reading List](Books/Reading%20List/)"
    )


def test_follows_a_note_inside_a_folder_that_moved() -> None:
    text = "[b](reading/2026/borges.md#quotes)"

    assert relink_markdown(text, "index.md", "index.md", "reading", "books") == (
        "[b](books/2026/borges.md#quotes)"
    )


def test_follows_an_image() -> None:
    text = "![cover](cover.png)"

    assert relink_markdown(
        text, "borges.md", "reading/borges.md", "borges.md", "reading/borges.md"
    ) == ("![cover](../cover.png)")


def test_leaves_a_link_between_two_files_that_moved_together() -> None:
    text = "[b](borges.md)"

    assert relink_markdown(text, "reading/index.md", "books/index.md", "reading", "books") == text


def test_leaves_what_is_outside_the_vault_alone() -> None:
    text = "[a](https://example.com/borges.md) [b](/borges.md) [c](#top) [d](../../borges.md)"

    assert relink_markdown(text, "a/n.md", "b/c/n.md", "a/n.md", "b/c/n.md") == text


def test_leaves_a_template_placeholder_alone() -> None:
    text = "[Inbox]({{inbox|url}}/)"

    assert relink_markdown(text, "a/n.md", "b/n.md", "a/n.md", "b/n.md") == text


def test_keeps_a_leading_dot_slash() -> None:
    text = "[b](./borges.md)"

    assert relink_markdown(text, "index.md", "index.md", "borges.md", "reading/borges.md") == (
        "[b](./reading/borges.md)"
    )


async def test_rewrites_markdown_links_across_the_vault_on_a_move(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "Reading List").mkdir()
    (vault / "Reading List" / "index.md").write_text("* [Borges](borges.md)\n")
    (vault / "Reading List" / "borges.md").write_text("[home](../home.md)\n")
    (vault / "home.md").write_text("[b](Reading%20List/borges.md)\n")

    await client.patch("/api/files/Reading List/borges.md", json={"path": "authors/borges.md"})

    assert (vault / "home.md").read_text() == "[b](authors/borges.md)\n"
    assert (vault / "authors" / "borges.md").read_text() == "[home](../home.md)\n"


async def test_rewrites_links_out_of_a_folder_that_moved(client: AsyncClient, vault: Path) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("[home](../home.md) [p](poe.md)\n")
    (vault / "reading" / "poe.md").write_text("# poe")
    (vault / "home.md").write_text("[r](reading/)\n")

    await client.patch("/api/folders/reading", json={"path": "archive/2026/reading"})

    assert (vault / "archive" / "2026" / "reading" / "borges.md").read_text() == (
        "[home](../../../home.md) [p](poe.md)\n"
    )
    assert (vault / "home.md").read_text() == "[r](archive/2026/reading/)\n"
