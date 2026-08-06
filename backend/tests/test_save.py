from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_writes_the_note_back_to_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.put("/api/files/index.md", json={"content": "# index\n\nEdited.\n"})

    assert response.status_code == 200
    # What came back is what landed on disk, stamp and all, because the client
    # sent text a save older than its own.
    assert response.json() == {"path": "index.md", "content": (vault / "index.md").read_text()}
    assert response.json()["content"].endswith("# index\n\nEdited.\n")


async def test_writes_a_note_inside_a_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "daily").mkdir()
    (vault / "daily" / "2026-08-05.md").write_text("# today")

    response = await client.put("/api/files/daily/2026-08-05.md", json={"content": "# tomorrow"})

    assert response.status_code == 200
    assert (vault / "daily" / "2026-08-05.md").read_text().endswith("# tomorrow")


async def test_keeps_the_text_it_was_given(client: AsyncClient, vault: Path) -> None:
    # The vault is the source of truth, so nothing below the frontmatter may be
    # normalised on the way in, line endings included.
    (vault / "unicode.md").write_text("# note")
    content = "# Grüße\n\nEmdash free, ✅ and 日本語.\r\nNo trailing newline."

    await client.put("/api/files/unicode.md", json={"content": content})

    written = (vault / "unicode.md").read_text(encoding="utf-8", newline="")
    assert written.endswith(content)


async def test_leaves_no_temporary_file_behind(client: AsyncClient, vault: Path) -> None:
    # The write goes through a temp file next to the target. It has to be gone,
    # and it must not show up in the listing even if it were not.
    (vault / "index.md").write_text("# index")

    await client.put("/api/files/index.md", json={"content": "# edited"})

    # The rule below guards against stalling an event loop, and a test reading
    # one throwaway directory has no loop worth protecting.
    assert sorted(p.name for p in vault.iterdir()) == ["index.md"]  # noqa: ASYNC240


async def test_refuses_to_create_a_note_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    response = await client.put("/api/files/missing.md", json={"content": "# new"})

    assert response.status_code == 404
    assert not (vault / "missing.md").exists()


async def test_refuses_to_create_a_folder(client: AsyncClient, vault: Path) -> None:
    response = await client.put("/api/files/projects/kasten.md", json={"content": "# new"})

    assert response.status_code == 404
    assert not (vault / "projects").exists()


async def test_refuses_to_climb_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    secret = vault.parent / "secret.md"
    secret.write_text("# not yours")

    response = await client.put("/api/files/%2E%2E%2Fsecret.md", json={"content": "# owned"})

    assert response.status_code == 404
    assert secret.read_text() == "# not yours"


async def test_refuses_an_absolute_path(client: AsyncClient, vault: Path) -> None:
    secret = vault.parent / "secret.md"
    secret.write_text("# not yours")

    response = await client.put(f"/api/files/{vault.parent}/secret.md", json={"content": "# owned"})

    assert response.status_code == 404
    assert secret.read_text() == "# not yours"


async def test_refuses_a_symlink_that_points_out_of_the_vault(
    client: AsyncClient, vault: Path
) -> None:
    secret = vault.parent / "secret.md"
    secret.write_text("# not yours")
    (vault / "innocent.md").symlink_to(secret)

    response = await client.put("/api/files/innocent.md", json={"content": "# owned"})

    assert response.status_code == 404
    assert secret.read_text() == "# not yours"


async def test_refuses_a_file_that_is_not_markdown(client: AsyncClient, vault: Path) -> None:
    (vault / "notes.txt").write_text("plain")

    response = await client.put("/api/files/notes.txt", json={"content": "# owned"})

    assert response.status_code == 404
    assert (vault / "notes.txt").read_text() == "plain"


async def test_refuses_a_hidden_file(client: AsyncClient, vault: Path) -> None:
    (vault / ".obsidian.md").write_text("# hidden")

    response = await client.put("/api/files/.obsidian.md", json={"content": "# owned"})

    assert response.status_code == 404
    assert (vault / ".obsidian.md").read_text() == "# hidden"


async def test_refuses_a_null_byte_rather_than_raising(client: AsyncClient, vault: Path) -> None:
    (vault / "note.md").write_text("# note")

    response = await client.put("/api/files/%00note.md", json={"content": "# owned"})

    assert response.status_code == 404


async def test_refuses_a_body_without_content(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.put("/api/files/index.md", json={})

    assert response.status_code == 422
    assert (vault / "index.md").read_text() == "# index"


async def test_reads_back_what_it_wrote(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    await client.put("/api/files/index.md", json={"content": "# index\n\nEdited.\n"})
    response = await client.get("/api/files/index.md")

    assert response.json()["content"].endswith("# index\n\nEdited.\n")


async def test_dates_the_note_it_writes_and_keeps_what_the_block_had(
    client: AsyncClient, vault: Path
) -> None:
    # A save is what `modified` means. The id and the creation date are the
    # note's from the first write and no later one may touch them.
    (vault / "index.md").write_text(
        "---\nid: kept\ncreated: 2020-01-01T00:00:00+00:00\n---\n# index"
    )

    await client.put("/api/files/index.md", json={"content": "# index\n\nEdited.\n"})

    written = (vault / "index.md").read_text()
    assert "\nid: kept\n" in written
    assert "\ncreated: 2020-01-01T00:00:00+00:00\n" in written
    modified = next(line for line in written.split("\n") if line.startswith("modified: "))
    assert datetime.fromisoformat(modified.removeprefix("modified: ")) > datetime(
        2020, 1, 1, tzinfo=UTC
    )
