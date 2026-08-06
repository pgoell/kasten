"""What a move does to the links that named the notes it moved."""

from typing import TYPE_CHECKING

import pytest

from kasten_backend.search import SearchError, notes_holding

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


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


async def test_refuses_to_move_a_note_it_cannot_read_the_vault_for(
    missing_vault: Path,
) -> None:
    # A rewrite that came up short would leave a link pointing at nothing, so
    # rg failing has to be an error here and not an empty answer.
    with pytest.raises(SearchError):
        await notes_holding(missing_vault, "borges")
