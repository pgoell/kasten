"""The pre-commit file-size check, run through the repo's real lefthook config.

Each test builds its own git repo in tmp_path, copies the real lefthook config
and file-size script into it, stages one case, and runs the command that
pre-commit runs. Copying the real config is what makes these fail on a hook
that lacks the check.
"""

import os
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).parents[2]
HOOK_ARGS = [
    "run",
    "pre-commit",
    "--commands",
    "file-size",
    "--no-auto-install",
    "--no-tty",
    "--colors",
    "off",
]


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)  # noqa: S603, S607


def write(root: Path, name: str, size: int) -> None:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("a" * size, encoding="utf-8")


def make_repo(root: Path, base_files: dict[str, int] | None = None) -> None:
    for name, size in (base_files or {}).items():
        write(root, name, size)
    for name in (".config/lefthook.yaml", "scripts/file_size.py"):
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / name, root / name)
    git(root, "init", "-q")
    git(root, "add", ".")
    git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base")


def run_hook(root: Path) -> subprocess.CompletedProcess[str]:
    # A LEFTHOOK_* variable in the caller's shell would change what lefthook does.
    env = {key: value for key, value in os.environ.items() if not key.startswith("LEFTHOOK")}
    lefthook = shutil.which("lefthook")
    assert lefthook is not None, "lefthook is not on PATH"
    return subprocess.run(  # noqa: S603
        [lefthook, *HOOK_ARGS],
        capture_output=True,
        text=True,
        cwd=root,
        env=env,
        check=False,
    )


def test_a_commit_staging_a_file_over_the_limit_fails(tmp_path: Path) -> None:
    make_repo(tmp_path)
    write(tmp_path, "big.md", 20004)
    git(tmp_path, "add", "big.md")

    result = run_hook(tmp_path)
    output = result.stdout + result.stderr

    assert result.returncode != 0
    assert "file-size: big.md is ~5001 tokens (bytes/4); the limit is 5000." in output
    assert "Split along a deep module" in output


def test_a_commit_staging_files_under_the_limit_passes(tmp_path: Path) -> None:
    make_repo(tmp_path)
    write(tmp_path, "small.md", 100)
    git(tmp_path, "add", "small.md")

    result = run_hook(tmp_path)
    output = result.stdout + result.stderr

    assert result.returncode == 0
    assert "✓ file-size" in output


def test_a_commit_deleting_a_file_over_the_limit_passes(tmp_path: Path) -> None:
    make_repo(tmp_path, {"big.md": 20004, "other.md": 30000})
    git(tmp_path, "rm", "-q", "big.md")

    result = run_hook(tmp_path)
    output = result.stdout + result.stderr

    # other.md is over the limit and stays tracked, so a whole-repo scan would fail.
    assert result.returncode == 0
    assert "file-size (skip) no files for inspection" in output
