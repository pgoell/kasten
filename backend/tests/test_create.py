from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_creates_a_note_at_the_vault_root(client: AsyncClient, vault: Path) -> None:
    # Not `index.md`, here or in any test below that reads the block: OKF
    # reserves that name and kasten writes no block into one.
    response = await client.post("/api/files/borges.md")

    assert response.status_code == 201
    assert response.json() == {"path": "borges.md", "content": (vault / "borges.md").read_text()}
    assert response.json()["content"].endswith("---\n")


async def test_creates_a_note_inside_a_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "daily").mkdir()

    response = await client.post("/api/files/daily/2026-08-05.md")

    assert response.status_code == 201
    assert response.json()["path"] == "daily/2026-08-05.md"
    assert (vault / "daily" / "2026-08-05.md").read_text().endswith("---\n")


async def test_refuses_to_write_over_a_note_that_is_there(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.post("/api/files/index.md")

    assert response.status_code == 409
    assert (vault / "index.md").read_text() == "# index"


async def test_lists_the_note_it_created(client: AsyncClient, vault: Path) -> None:
    await client.post("/api/files/index.md")
    response = await client.get("/api/files")

    assert response.json() == ["index.md"]


async def test_makes_the_folders_on_the_way(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/files/reading/2026/borges.md")

    assert response.status_code == 201
    assert response.json()["path"] == "reading/2026/borges.md"
    assert (vault / "reading" / "2026").is_dir()
    assert (vault / "reading" / "2026" / "borges.md").read_text().endswith("---\n")


async def test_creates_a_note_through_a_folder_symlink(client: AsyncClient, vault: Path) -> None:
    # A link to a real folder is a folder, and the rule that refuses a broken
    # ancestor must not refuse this one.
    (vault / "reading").mkdir()
    (vault / "daily").symlink_to(vault / "reading")

    response = await client.post("/api/files/daily/2026-08-05.md")

    assert response.status_code == 201
    assert response.json()["path"] == "reading/2026-08-05.md"
    assert (vault / "reading" / "2026-08-05.md").read_text().endswith("---\n")


async def test_creates_the_vault_directory_when_it_is_missing(
    client: AsyncClient, missing_vault: Path
) -> None:
    # A note names its folders into being, and the vault root is the outermost
    # of them. The listing already reads a missing vault as an empty one.
    response = await client.post("/api/files/borges.md")

    assert response.status_code == 201
    assert (missing_vault / "borges.md").read_text().endswith("---\n")


async def test_answers_with_the_canonical_path_not_the_url_spelling(
    client: AsyncClient, vault: Path
) -> None:
    # The client navigates to what comes back, so `ideas/../kasten.md` must not
    # end up in `?note=`.
    response = await client.post("/api/files/ideas%2F..%2Fkasten.md")

    assert response.status_code == 201
    assert response.json()["path"] == "kasten.md"
    assert (vault / "kasten.md").read_text().endswith("---\n")


async def test_refuses_a_note_inside_a_file(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.post("/api/files/index.md/nested.md")

    assert response.status_code == 400
    assert (vault / "index.md").read_text() == "# index"


async def test_refuses_a_symlink_loop_rather_than_raising(client: AsyncClient, vault: Path) -> None:
    # A loop is the one link `resolve` cannot follow, and it hands the path back
    # still a link, which the write then raises on.
    (vault / "a.md").symlink_to(vault / "b.md")
    (vault / "b.md").symlink_to(vault / "a.md")

    response = await client.post("/api/files/a.md")

    assert response.status_code == 400
    # `is_file` on a loop is False whether or not a note was written, so ask the
    # vault what it holds instead. The rule below guards against stalling an
    # event loop, and a test reading one throwaway directory has no loop worth
    # protecting.
    assert sorted(p.name for p in vault.iterdir()) == ["a.md", "b.md"]  # noqa: ASYNC240


async def test_refuses_a_folder_that_is_a_symlink_loop_rather_than_raising(
    client: AsyncClient, vault: Path
) -> None:
    # `resolve` gives up on the loop and hands back an unresolved path, so the
    # leaf is no link and only the ancestor gives the loop away. It is a link
    # that neither exists nor is a folder, and mkdir raises on it.
    (vault / "d1").symlink_to(vault / "d2")
    (vault / "d2").symlink_to(vault / "d1")

    response = await client.post("/api/files/d1/n.md")

    assert response.status_code == 400
    assert sorted(p.name for p in vault.iterdir()) == ["d1", "d2"]  # noqa: ASYNC240


async def test_refuses_a_name_the_filesystem_will_not_take(
    client: AsyncClient, vault: Path
) -> None:
    response = await client.post(f"/api/files/{'n' * 300}.md")

    assert response.status_code == 400
    assert list(vault.iterdir()) == []  # noqa: ASYNC240


async def test_refuses_a_folder_name_the_filesystem_will_not_take(
    client: AsyncClient, vault: Path
) -> None:
    response = await client.post(f"/api/files/{'n' * 300}/n.md")

    assert response.status_code == 400
    assert list(vault.iterdir()) == []  # noqa: ASYNC240


async def test_makes_no_folder_for_a_name_the_filesystem_will_not_take(
    client: AsyncClient, vault: Path
) -> None:
    # The folders are made before the write, so a name refused by the write
    # alone would leave `sub` behind with no note in it.
    response = await client.post(f"/api/files/sub/{'n' * 300}.md")

    assert response.status_code == 400
    assert list(vault.iterdir()) == []  # noqa: ASYNC240


async def test_refuses_to_climb_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    response = await client.post("/api/files/%2E%2E%2Fsecret.md")

    assert response.status_code == 400
    assert not (vault.parent / "secret.md").exists()


async def test_refuses_an_absolute_path(client: AsyncClient, vault: Path) -> None:
    response = await client.post(f"/api/files/{vault.parent}/secret.md")

    assert response.status_code == 400
    assert not (vault.parent / "secret.md").exists()


async def test_refuses_a_symlink_that_points_out_of_the_vault(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "innocent.md").symlink_to(vault.parent / "secret.md")

    response = await client.post("/api/files/innocent.md")

    assert response.status_code == 400
    assert not (vault.parent / "secret.md").exists()


async def test_refuses_a_name_that_is_not_markdown(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/files/notes.txt")

    assert response.status_code == 400
    assert not (vault / "notes.txt").exists()


async def test_refuses_a_hidden_name(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/files/.obsidian.md")

    assert response.status_code == 400
    assert not (vault / ".obsidian.md").exists()


async def test_refuses_a_null_byte_rather_than_raising(client: AsyncClient, vault: Path) -> None:
    # Every filesystem call raises on an embedded null, which would turn a
    # hostile path into a 500. There is no name to check, so check the vault.
    response = await client.post("/api/files/%00note.md")

    assert response.status_code == 400
    # The rule below guards against stalling an event loop, and a test reading
    # one throwaway directory has no loop worth protecting.
    assert list(vault.iterdir()) == []  # noqa: ASYNC240


async def test_gives_the_new_note_its_frontmatter(client: AsyncClient, vault: Path) -> None:
    # The note is named by its id from the moment it exists, not from its first
    # save. What the block holds is `test_frontmatter.py`'s business.
    response = await client.post("/api/files/borges.md")

    written = (vault / "borges.md").read_text()
    assert written.startswith("---\nid: ")
    assert response.json()["content"] == written


async def test_starts_the_note_with_the_body_it_was_given(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/files/borges.md", json={"content": "\n# borges\n"})

    assert response.status_code == 201
    written = (vault / "borges.md").read_text()
    assert written.startswith("---\nid: ")
    assert written.endswith("---\n\n# borges\n")
    assert response.json()["content"] == written


async def test_stamps_a_body_that_carries_its_own_block(client: AsyncClient, vault: Path) -> None:
    # A body arrives the way a save's text does, so the block in it is filled in
    # rather than written over, and a note made from one keeps its own fields.
    response = await client.post(
        "/api/files/borges.md", json={"content": "---\ntags: [a]\n---\n# borges\n"}
    )

    assert response.status_code == 201
    written = (vault / "borges.md").read_text()
    assert "tags: [a]" in written
    assert written.startswith("---\nid: ")
    assert written.endswith("---\n# borges\n")
