"""The pre-commit file-size and fan-out checks, run through the real lefthook config.

Each test builds its own git repo in tmp_path, copies the real lefthook config
and scripts/structure into it, stages one case, and runs the commands that
pre-commit runs. Copying the real config is what makes these fail on a hook
that lacks the check.
"""

import shutil
from typing import TYPE_CHECKING

from backend.tests.structure.repo import git, run, write

if TYPE_CHECKING:
    import subprocess
    from collections.abc import Callable
    from pathlib import Path

CONFIG = ".config/lefthook.yaml"


def run_hook(root: Path) -> subprocess.CompletedProcess[str]:
    lefthook = shutil.which("lefthook")
    assert lefthook is not None, "lefthook is not on PATH"
    return run(
        root,
        lefthook,
        "run",
        "pre-commit",
        "--commands",
        "file-size,fan-out",
        "--no-auto-install",
        "--no-tty",
        "--colors",
        "off",
    )


def test_a_commit_staging_a_file_over_the_limit_fails(make_repo: Callable[..., Path]) -> None:
    tmp_path = make_repo(copy=(CONFIG,))
    write(tmp_path, "big.md", 20004)
    git(tmp_path, "add", "big.md")

    result = run_hook(tmp_path)
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "file-size: big.md is ~5001 tokens (bytes/4); the limit is 5000." in output
    assert "Split along a deep module" in output


def test_a_commit_staging_files_under_the_limit_passes(make_repo: Callable[..., Path]) -> None:
    tmp_path = make_repo(copy=(CONFIG,))
    write(tmp_path, "small.md", 100)
    git(tmp_path, "add", "small.md")

    result = run_hook(tmp_path)
    output = result.stdout + result.stderr

    assert result.returncode == 0
    assert "✓ file-size" in output


def test_a_commit_deleting_a_file_over_the_limit_passes(make_repo: Callable[..., Path]) -> None:
    tmp_path = make_repo({"big.md": 20004, "other.md": 30000}, copy=(CONFIG,))
    git(tmp_path, "rm", "-q", "big.md")

    result = run_hook(tmp_path)
    output = result.stdout + result.stderr

    # other.md is over the limit and stays tracked, so a whole-repo scan would fail.
    assert result.returncode == 0
    assert "file-size (skip) no files for inspection" in output


def test_a_commit_staging_an_eighth_entry_in_a_folder_fails(make_repo: Callable[..., Path]) -> None:
    tmp_path = make_repo({f"src/f{i}.md": 10 for i in range(7)}, copy=(CONFIG,))
    write(tmp_path, "src/f7.md", 10)
    git(tmp_path, "add", "src/f7.md")

    result = run_hook(tmp_path)
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "fan-out: src holds 8 entries; the limit is 7." in output
