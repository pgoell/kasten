"""scripts/structure/check-file-size with kasten's .file-size-excludes."""

from typing import TYPE_CHECKING

from backend.tests.structure.repo import REPO, git, run, write

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

CHECK = "scripts/structure/check-file-size"


def test_the_repo_as_committed_passes() -> None:
    result = run(REPO, CHECK)
    assert result.returncode == 0, result.stderr


def test_a_new_file_over_the_cap_fails_with_the_split_advice(
    make_repo: Callable[..., Path],
) -> None:
    root = make_repo({"small.md": 100})
    write(root, "big.md", 20004)
    git(root, "add", "big.md")
    git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "grow")

    result = run(root, CHECK)

    assert result.returncode == 1
    assert "file-size: big.md is ~5001 tokens (bytes/4); the limit is 5000." in result.stderr
    assert "small.md" not in result.stderr
    assert "Split along a deep module" in result.stderr


def test_a_file_at_the_cap_passes(make_repo: Callable[..., Path]) -> None:
    root = make_repo({"edge.md": 20003})
    assert run(root, CHECK).returncode == 0


def test_kastens_generated_and_binary_files_are_excluded(make_repo: Callable[..., Path]) -> None:
    names = [
        "frontend/bun.lock",
        "frontend/openapi.json",
        "frontend/src/lib/api-types.ts",
        "frontend/tests/frame/vault-graph-dev.json",
        "frontend/tests/fixtures/cover.epub",
        "docs/a.svg",
        "uv.lock",
        "LICENSE",
    ]
    root = make_repo(dict.fromkeys(names, 30000), copy=(".file-size-excludes",))

    result = run(root, CHECK)

    assert result.returncode == 0, result.stderr
