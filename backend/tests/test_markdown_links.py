from typing import TYPE_CHECKING
from urllib.parse import quote

from kasten_backend.anki import media_path
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


def test_leaves_an_image_when_the_note_holding_it_moves() -> None:
    # An embed is read from the vault root, so the note moving does not move it.
    text = "![cover](cover.png)"

    assert (
        relink_markdown(text, "borges.md", "reading/borges.md", "borges.md", "reading/borges.md")
        == text
    )


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


# The editor writes a link with encodeURI, so an accented name reaches the
# file as `%C3%BC`, a spelling the move has to look for as well as the raw one.
async def test_follows_a_folder_whose_accented_name_the_link_escapes(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "Bücher").mkdir()
    (vault / "Bücher" / "x.png").write_bytes(b"png")
    (vault / "Müll").mkdir()
    (vault / "Müll" / "y.png").write_bytes(b"png")
    (vault / "home.md").write_text(
        "# Home\n\nsee ![](B%C3%BCcher/x.png) here\n\n![](M%C3%BCll/y.png)\n"
    )

    await client.patch("/api/folders/Bücher", json={"path": "Books"})

    assert (vault / "home.md").read_text() == (
        "# Home\n\nsee ![](Books/x.png) here\n\n![](M%C3%BCll/y.png)\n"
    )


async def test_follows_a_folder_whose_name_the_link_escapes_in_lowercase(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "Bücher").mkdir()
    (vault / "Bücher" / "x.png").write_bytes(b"png")
    (vault / "home.md").write_text("![](B%c3%bccher/x.png)\n")

    await client.patch("/api/folders/Bücher", json={"path": "Books"})

    assert (vault / "home.md").read_text() == "![](Books/x.png)\n"


async def test_follows_a_folder_whose_accented_name_the_link_writes_raw(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "Bücher").mkdir()
    (vault / "Bücher" / "x.png").write_bytes(b"png")
    (vault / "home.md").write_text("![](Bücher/x.png)\n")

    await client.patch("/api/folders/Bücher", json={"path": "Books"})

    assert (vault / "home.md").read_text() == "![](Books/x.png)\n"


async def test_follows_a_note_whose_accented_name_the_link_escapes(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "Über.md").write_text("# Über")
    (vault / "home.md").write_text("[ü](%C3%9Cber.md)\n")

    await client.patch("/api/files/Über.md", json={"path": "notes/Über.md"})

    assert (vault / "home.md").read_text() == "[ü](notes/Über.md)\n"


# An embed is read from the vault root, the way the editor draws it, and a plain
# link from the folder of the file holding it. These pin the split (#248).


async def test_leaves_an_embed_when_its_note_moves_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "A").mkdir()
    (vault / "Images").mkdir()
    (vault / "Images" / "x.png").write_bytes(b"png")
    (vault / "A" / "n.md").write_text("![](Images/x.png)\n")

    await client.patch("/api/files/A/n.md", json={"path": "B/n.md"})

    assert (vault / "B" / "n.md").read_text() == "![](Images/x.png)\n"


async def test_leaves_an_imported_decks_embeds_when_it_moves(
    client: AsyncClient, vault: Path
) -> None:
    # Spelled the way the Anki import writes them: `media_path`, then quoted.
    image = quote(media_path("Flashcards", "Spanish", "a.png"))
    sound = quote(media_path("Flashcards", "Spanish", "b.mp3"))
    (vault / "Flashcards" / "Spanish media").mkdir(parents=True)
    (vault / "Flashcards" / "Spanish media" / "a.png").write_bytes(b"png")
    (vault / "Flashcards" / "Spanish media" / "b.mp3").write_bytes(b"mp3")
    text = f"Q: hola\n\n![]({image})\n\n![]({sound})\n"
    (vault / "Flashcards" / "Spanish.md").write_text(text)

    await client.patch("/api/files/Flashcards/Spanish.md", json={"path": "Decks/Spanish.md"})

    assert (vault / "Decks" / "Spanish.md").read_text() == text


async def test_follows_the_folder_an_embed_shows_from_any_folder(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "A").mkdir()
    (vault / "Images").mkdir()
    (vault / "Images" / "x.png").write_bytes(b"png")
    (vault / "root.md").write_text("![](Images/x.png)\n")
    (vault / "A" / "n.md").write_text("![](Images/x.png)\n")

    await client.patch("/api/folders/Images", json={"path": "Pics"})

    assert (vault / "root.md").read_text() == "![](Pics/x.png)\n"
    assert (vault / "A" / "n.md").read_text() == "![](Pics/x.png)\n"


async def test_a_plain_link_still_reads_from_its_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "A").mkdir()
    (vault / "A" / "n.md").write_text("[x](Images/x.png)\n")

    await client.patch("/api/files/A/n.md", json={"path": "B/n.md"})

    assert (vault / "B" / "n.md").read_text() == "[x](../A/Images/x.png)\n"


async def test_follows_an_embed_moving_with_its_note(client: AsyncClient, vault: Path) -> None:
    (vault / "A").mkdir()
    (vault / "A" / "pic.png").write_bytes(b"png")
    (vault / "A" / "n.md").write_text("![](A/pic.png)\n")

    await client.patch("/api/folders/A", json={"path": "B"})

    assert (vault / "B" / "n.md").read_text() == "![](B/pic.png)\n"


async def test_keeps_an_embeds_escapes_and_tail(client: AsyncClient, vault: Path) -> None:
    (vault / "A").mkdir()
    (vault / "My Images").mkdir()
    (vault / "My Images" / "x.png").write_bytes(b"png")
    (vault / "A" / "n.md").write_text("![](My%20Images/x.png#a) ![](My%20Images/x.png?v=1)\n")

    await client.patch("/api/folders/My Images", json={"path": "New Pics"})

    assert (vault / "A" / "n.md").read_text() == (
        "![](New%20Pics/x.png#a) ![](New%20Pics/x.png?v=1)\n"
    )


def test_leaves_an_embed_outside_the_vault_alone() -> None:
    text = "![](../x.png) ![](/x.png) ![](https://example.com/x.png)"

    assert relink_markdown(text, "A/n.md", "B/C/n.md", "A/n.md", "B/C/n.md") == text


async def test_previews_no_note_whose_embeds_stay(client: AsyncClient, vault: Path) -> None:
    (vault / "A").mkdir()
    (vault / "Images").mkdir()
    (vault / "Images" / "x.png").write_bytes(b"png")
    (vault / "A" / "n.md").write_text("![](Images/x.png)\n")
    (vault / "other.md").write_text("![](Images/x.png)\n")

    response = await client.get(
        "/api/move-preview", params={"source": "A/n.md", "target": "B/n.md"}
    )

    assert response.json()["rewrites"] == []
