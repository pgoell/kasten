"""Throwaway git repos holding kasten's real structure scripts and dotfiles.

Each test copies what the repo ships into tmp_path, so a test fails when the
shipped script, config or exclude file lacks the rule it checks.
"""

import os
import shutil
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

REPO = Path(__file__).parents[3]
SCRIPTS = REPO / "scripts" / "structure"


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)  # noqa: S603, S607


def write(root: Path, name: str, size: int) -> None:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("a" * size, encoding="utf-8")


def run(root: Path, *args: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    # A LEFTHOOK_* or GIT_* variable in the caller's shell would change what the tools do.
    env = {k: v for k, v in os.environ.items() if not k.startswith(("LEFTHOOK", "GIT_"))}
    return subprocess.run(  # noqa: S603
        list(args), capture_output=True, text=True, cwd=root, env=env, input=stdin, check=False
    )


def repo_builder(tmp_path: Path) -> Callable[..., Path]:
    """Build a committed repo with scripts/structure and the given files of given sizes."""

    def build(files: dict[str, int] | None = None, *, copy: tuple[str, ...] = ()) -> Path:
        shutil.copytree(SCRIPTS, tmp_path / "scripts" / "structure")
        for name in copy:
            (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / name, tmp_path / name)
        for name, size in (files or {}).items():
            write(tmp_path, name, size)
        git(tmp_path, "init", "-q")
        git(tmp_path, "add", ".")
        git(tmp_path, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base")
        return tmp_path

    return build
