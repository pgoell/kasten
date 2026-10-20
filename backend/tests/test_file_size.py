"""The file-size script, run against small git repos in tmp_path.

Each test builds its own repo, so the output read is the script's, not the
state of this repo's docs or code.
"""

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / "scripts" / "file_size.py"


def run(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        cwd=cwd,
        check=False,
    )


def write(root: Path, name: str, size: int) -> None:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("a" * size, encoding="utf-8")


def git_init_and_add(root: Path) -> None:
    # The script reads the index, so files need only be added, not committed.
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)  # noqa: S607
    subprocess.run(["git", "add", "."], cwd=root, check=True)  # noqa: S607


def test_no_arguments_lists_every_tracked_file_over_the_limit(tmp_path: Path) -> None:
    write(tmp_path, "big.md", 20004)
    write(tmp_path, "bigger.md", 30000)
    write(tmp_path, "small.md", 100)
    git_init_and_add(tmp_path)

    result = run(tmp_path)

    assert result.returncode == 1
    assert "file-size: bigger.md is ~7500 tokens" in result.stdout
    assert "file-size: big.md is ~5001 tokens" in result.stdout
    assert "small.md" not in result.stdout


def test_a_file_over_the_limit_gets_the_drafted_message(tmp_path: Path) -> None:
    write(tmp_path, "notes.md", 20004)

    result = run(tmp_path, "notes.md")

    assert result.returncode == 1
    assert (
        result.stdout.splitlines()[0]
        == "file-size: notes.md is ~5001 tokens (bytes/4); the limit is 5000."
    )
    for phrase in (
        "Big files cost agents",
        "pass-through wrappers, barrel files",
        "A Philosophy of Software",
        "Docs: split by topic into a folder with an index page",
    ):
        assert phrase in result.stdout


def test_excluded_files_are_never_counted(tmp_path: Path) -> None:
    for name in ("uv.lock", "frontend/openapi.json", "cover.png", "LICENSE"):
        write(tmp_path, name, 30000)
    git_init_and_add(tmp_path)

    result = run(tmp_path)

    assert result.returncode == 0
    assert result.stdout == ""


def test_a_file_at_the_limit_passes(tmp_path: Path) -> None:
    write(tmp_path, "edge.md", 20000)

    result = run(tmp_path, "edge.md")

    assert result.returncode == 0
