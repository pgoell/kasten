from importlib.metadata import version
from typing import TYPE_CHECKING

from kasten_backend.build import build_id

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

COMMIT = "4d1f6a2c9b8e7d6c5b4a39281706f5e4d3c2b1a0"


def repo_at(root: Path, head: str, *, commit: str | None = None) -> Path:
    """A `.git` holding one HEAD, and the branch file it names where asked."""
    git = root / ".git"
    git.mkdir()
    (git / "HEAD").write_text(f"{head}\n")
    if commit is not None:
        branch = git / "refs" / "heads" / "main"
        branch.parent.mkdir(parents=True)
        branch.write_text(f"{commit}\n")
    return root


def test_names_the_commit_the_tree_is_on(tmp_path: Path) -> None:
    # Development bind-mounts the repo and runs the source, where the version in
    # `pyproject.toml` is the last release and says nothing about the code.
    root = repo_at(tmp_path, "ref: refs/heads/main", commit=COMMIT)

    assert build_id(root) == "4d1f6a2"


def test_names_the_commit_a_detached_head_is_on(tmp_path: Path) -> None:
    # What a `git checkout <sha>` leaves behind, which is also what a CI
    # checkout of a tag leaves behind: the sha itself, no ref to follow.
    root = repo_at(tmp_path, COMMIT)

    assert build_id(root) == "4d1f6a2"


def test_falls_back_to_the_release_with_no_repo_beside_it(tmp_path: Path) -> None:
    # Production installs a wheel and copies no `.git`, so the release the
    # package carries is the whole answer.
    assert build_id(tmp_path) == version("kasten-backend")


def test_falls_back_to_the_release_when_the_branch_file_is_packed(tmp_path: Path) -> None:
    # `git gc` writes the loose ref into `packed-refs` and deletes it. Reading
    # that file too would be a parser for a case a working tree rarely reaches,
    # and the release is a truthful answer rather than a guess.
    root = repo_at(tmp_path, "ref: refs/heads/main")

    assert build_id(root) == version("kasten-backend")


async def test_reports_what_is_running(client: AsyncClient) -> None:
    response = await client.get("/api/version")

    assert response.status_code == 200
    assert response.json() == {"backend": build_id()}
