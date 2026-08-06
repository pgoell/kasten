import shutil
import subprocess
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from httpx import AsyncClient

JJ = shutil.which("jj")

pytestmark = pytest.mark.skipif(JJ is None, reason="jj is not installed")


def jj(vault: Path, *args: str) -> str:
    """Run a jj command against the test vault and hand back its output."""
    assert JJ is not None
    finished = subprocess.run(  # noqa: S603
        [JJ, "--repository", str(vault), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return finished.stdout


def descriptions(vault: Path) -> list[str]:
    """Every change in the repo, newest first, described."""
    log = jj(vault, "log", "--no-graph", "-T", 'description ++ "\\n"')
    return [line for line in log.splitlines() if line]


def changed_paths(vault: Path, revision: str) -> list[str]:
    """Every path one change touches, spelled from the vault root."""
    # `--ignore-working-copy` because every other jj command snapshots the
    # working copy on the way past, which would record a note the route left
    # unrecorded and answer the question the test is asking.
    listing = jj(
        vault,
        "--ignore-working-copy",
        "log",
        "-r",
        revision,
        "--no-graph",
        "-T",
        'diff.files().map(|file| file.path()).join("\\n")',
    )
    return [line for line in listing.splitlines() if line]


def moved_paths(vault: Path, revision: str) -> list[str]:
    """Every path one change touches, spelled `source -> target`.

    A rename is one entry with two different paths, because jj matches the
    content across the move rather than recording a delete and an add. Anything
    else names the same path twice.
    """
    template = (
        'diff.files().map(|file| file.source().path() ++ " -> " ++ file.target().path())'
        '.join("\\n")'
    )
    listing = jj(
        vault, "--ignore-working-copy", "log", "-r", revision, "--no-graph", "-T", template
    )
    return [line for line in listing.splitlines() if line]


@pytest.fixture
def versioned_vault(vault: Path) -> Iterator[Path]:
    """A vault that is a colocated jj repo, the way the runbook sets one up."""
    assert JJ is not None
    # Not through `jj()`: `--repository` names a repo that does not exist yet.
    subprocess.run(  # noqa: S603
        [JJ, "git", "init", "--colocate", str(vault)],
        capture_output=True,
        text=True,
        check=True,
    )
    yield vault


async def test_names_the_change_after_the_note_being_saved(
    client: AsyncClient, versioned_vault: Path
) -> None:
    (versioned_vault / "index.md").write_text("# index")

    await client.put("/api/files/index.md", json={"content": "# edited"})

    assert descriptions(versioned_vault)[0] == "vault: index.md"


async def test_keeps_every_save_of_one_note_in_one_change(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # A change per save would be hundreds a session and read as noise.
    (versioned_vault / "index.md").write_text("# index")

    await client.put("/api/files/index.md", json={"content": "# once"})
    await client.put("/api/files/index.md", json={"content": "# twice"})
    await client.put("/api/files/index.md", json={"content": "# thrice"})

    assert descriptions(versioned_vault).count("vault: index.md") == 1


async def test_starts_a_new_change_when_another_note_is_saved(
    client: AsyncClient, versioned_vault: Path
) -> None:
    (versioned_vault / "index.md").write_text("# index")
    (versioned_vault / "daily").mkdir()
    (versioned_vault / "daily" / "2026-08-05.md").write_text("# today")

    await client.put("/api/files/index.md", json={"content": "# edited"})
    await client.put("/api/files/daily/2026-08-05.md", json={"content": "# edited"})

    assert descriptions(versioned_vault)[:2] == [
        "vault: daily/2026-08-05.md",
        "vault: index.md",
    ]


async def test_leaves_the_text_a_save_overwrote_readable(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # The whole point. The vault has no other copy, so the version before the
    # save has to be reachable.
    (versioned_vault / "index.md").write_text("# the text that was there\n")

    await client.put("/api/files/index.md", json={"content": "# gone\n"})

    # `root:` because a bare path is read relative to the working directory,
    # which is the repo root only by luck.
    assert jj(versioned_vault, "file", "show", "-r", "@-", "root:index.md") == (
        "# the text that was there\n"
    )


async def test_records_every_save_in_the_operation_log(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # Changes are per note, so per-save rollback lives in the operation log.
    (versioned_vault / "index.md").write_text("# index")
    before = len(jj(versioned_vault, "op", "log", "--no-graph", "-T", '"x\\n"').splitlines())

    await client.put("/api/files/index.md", json={"content": "# once"})
    await client.put("/api/files/index.md", json={"content": "# twice"})

    after = len(jj(versioned_vault, "op", "log", "--no-graph", "-T", '"x\\n"').splitlines())
    assert after > before


async def test_names_the_change_after_the_note_being_created(
    client: AsyncClient, versioned_vault: Path
) -> None:
    await client.post("/api/files/index.md")

    assert descriptions(versioned_vault)[0] == "vault: index.md"


async def test_starts_a_new_change_for_each_note_created(
    client: AsyncClient, versioned_vault: Path
) -> None:
    await client.post("/api/files/index.md")
    await client.post("/api/files/daily/2026-08-05.md")

    assert descriptions(versioned_vault)[:2] == [
        "vault: daily/2026-08-05.md",
        "vault: index.md",
    ]


async def test_puts_the_created_note_in_its_own_change(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # Either call order names the change the same way, so the description
    # proves nothing. The order decides which change holds the note.
    await client.post("/api/files/index.md")

    assert changed_paths(versioned_vault, "@") == ["index.md"]


async def test_keeps_each_created_note_out_of_the_change_before_it(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # Write the file before opening the change and jj hands it to the change
    # already in hand, so every note lands one change too early.
    await client.post("/api/files/index.md")
    await client.post("/api/files/daily/2026-08-05.md")

    assert changed_paths(versioned_vault, "@") == ["daily/2026-08-05.md"]
    assert changed_paths(versioned_vault, "@-") == ["index.md"]


async def test_records_the_created_note_before_the_request_returns(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # The snapshot at the end of the create is what records the note. Drop it
    # and the note only sits on disk until some later jj command notices, which
    # folds whatever happened in between into the same snapshot.
    await client.post("/api/files/index.md")

    # `root:` because a bare path is read relative to the working directory,
    # which is the repo root only by luck. A new note is empty, so the read
    # coming back at all is the assertion.
    assert (
        jj(versioned_vault, "--ignore-working-copy", "file", "show", "-r", "@", "root:index.md")
        == ""
    )


async def test_names_the_change_after_the_path_a_move_lands_on(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # The new path, so `jj log` names the note as it is now rather than as it
    # was, and a move reads as a change to the note it produced.
    (versioned_vault / "inbox").mkdir()
    (versioned_vault / "inbox" / "typo.md").write_text("# borges")

    await client.patch("/api/files/inbox/typo.md", json={"path": "reading/borges.md"})

    assert descriptions(versioned_vault)[0] == "vault: reading/borges.md"


async def test_records_a_move_as_one_rename(client: AsyncClient, versioned_vault: Path) -> None:
    # Both ends in one entry, which is jj matching the content across the move.
    # A delete and an add would say the same thing about the working copy and
    # lose that the note is the note it was.
    (versioned_vault / "inbox").mkdir()
    (versioned_vault / "inbox" / "borges.md").write_text("# borges")
    # The note has to be in a change of its own to have moved out of one.
    await client.put("/api/files/inbox/borges.md", json={"content": "# borges"})

    await client.patch("/api/files/inbox/borges.md", json={"path": "reading/borges.md"})

    assert moved_paths(versioned_vault, "@") == ["inbox/borges.md -> reading/borges.md"]


async def test_leaves_the_note_readable_at_the_path_it_left(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # A move must not be the one write that loses a note. The change before it
    # still answers at the old path, so a rename you did not mean can be walked
    # back. This holds because the note was committed before the move rather
    # than because of how the move is bracketed, which is what the two tests
    # above cover.
    (versioned_vault / "inbox").mkdir()
    (versioned_vault / "inbox" / "borges.md").write_text("# borges\n")
    await client.put("/api/files/inbox/borges.md", json={"content": "# borges\n"})

    await client.patch("/api/files/inbox/borges.md", json={"path": "reading/borges.md"})

    assert jj(versioned_vault, "file", "show", "-r", "@-", "root:inbox/borges.md") == "# borges\n"


async def test_leaves_no_change_behind_when_it_refuses_a_move(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # Every refusal returns before the route reaches jj, so a bounced move adds
    # nothing to the log, empty or otherwise.
    (versioned_vault / "index.md").write_text("# index")
    (versioned_vault / "home.md").write_text("# home")
    before = descriptions(versioned_vault)

    await client.patch("/api/files/index.md", json={"path": "home.md"})
    await client.patch("/api/files/absent.md", json={"path": "elsewhere.md"})
    await client.patch("/api/files/index.md", json={"path": "../escape.md"})

    assert descriptions(versioned_vault) == before


async def test_names_the_change_after_the_folder_a_move_lands_on(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # The trailing slash is what tells this apart from the change a note's move
    # leaves, which `jj log` would otherwise show in the same words.
    (versioned_vault / "inbox").mkdir()
    (versioned_vault / "inbox" / "borges.md").write_text("# borges")

    await client.patch("/api/folders/inbox", json={"path": "reading/2026"})

    assert descriptions(versioned_vault)[0] == "vault: reading/2026/"


async def test_records_a_folder_move_as_a_rename_of_every_note(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # Every note under the folder moved, and jj matches the content across each
    # one, so the change reads as the renames it is rather than a subtree
    # deleted and another added.
    (versioned_vault / "inbox" / "deep").mkdir(parents=True)
    (versioned_vault / "inbox" / "borges.md").write_text("# borges")
    (versioned_vault / "inbox" / "deep" / "kasten.md").write_text("# kasten")
    # The notes have to be in a change of their own to have moved out of one.
    await client.put("/api/files/inbox/borges.md", json={"content": "# borges"})
    await client.put("/api/files/inbox/deep/kasten.md", json={"content": "# kasten"})

    await client.patch("/api/folders/inbox", json={"path": "reading"})

    assert moved_paths(versioned_vault, "@") == [
        "inbox/borges.md -> reading/borges.md",
        "inbox/deep/kasten.md -> reading/deep/kasten.md",
    ]


async def test_leaves_no_change_behind_when_it_refuses_a_folder_move(
    client: AsyncClient, versioned_vault: Path
) -> None:
    (versioned_vault / "inbox").mkdir()
    (versioned_vault / "inbox" / "borges.md").write_text("# borges")
    (versioned_vault / "reading").mkdir()
    (versioned_vault / "reading" / "kasten.md").write_text("# kasten")
    before = descriptions(versioned_vault)

    await client.patch("/api/folders/inbox", json={"path": "reading"})
    await client.patch("/api/folders/absent", json={"path": "elsewhere"})
    await client.patch("/api/folders/inbox", json={"path": "inbox/deeper"})

    assert descriptions(versioned_vault) == before


async def test_leaves_no_change_behind_when_it_refuses_a_create(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # Both refusals return before the route reaches jj, so a bounced create
    # adds nothing to the log, empty or otherwise.
    await client.post("/api/files/index.md")
    await client.post("/api/files/daily/2026-08-05.md")
    before = len(jj(versioned_vault, "log", "--no-graph", "-T", '"x\\n"').splitlines())

    assert (await client.post("/api/files/index.md")).status_code == 409
    assert (await client.post("/api/files/notes.txt")).status_code == 400

    after = len(jj(versioned_vault, "log", "--no-graph", "-T", '"x\\n"').splitlines())
    assert after == before


async def test_writes_the_note_even_when_the_repo_is_broken(
    client: AsyncClient, vault: Path
) -> None:
    # A directory that looks like a repo and is not. Every jj command fails,
    # and the save still has to land: history is worth less than the write.
    (vault / ".jj").mkdir()
    (vault / "index.md").write_text("# index")

    response = await client.put("/api/files/index.md", json={"content": "# edited"})

    assert response.status_code == 200
    assert (vault / "index.md").read_text() == "# edited"


async def test_leaves_a_vault_that_is_not_a_repo_alone(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    await client.put("/api/files/index.md", json={"content": "# edited"})

    assert not (vault / ".jj").exists()


async def test_creates_a_note_in_a_vault_that_is_not_a_repo(
    client: AsyncClient, vault: Path
) -> None:
    response = await client.post("/api/files/index.md")

    assert response.status_code == 201
    assert not (vault / ".jj").exists()
