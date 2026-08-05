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
