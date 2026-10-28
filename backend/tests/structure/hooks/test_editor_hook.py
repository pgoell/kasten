"""scripts/structure/editor-hook, the PostToolUse hook in .claude/settings.json.

It guards the plugin's structure-hook, so every test goes through it.
"""

import json
import time
from typing import TYPE_CHECKING

from backend.tests.structure.repo import REPO, git, run, write

if TYPE_CHECKING:
    import subprocess
    from collections.abc import Callable
    from pathlib import Path

HOOK = "scripts/structure/editor-hook"


def edit(root: Path, path: Path) -> subprocess.CompletedProcess[str]:
    event = {"tool_name": "Write", "tool_input": {"file_path": str(path)}}
    return run(root, str(root / HOOK), stdin=json.dumps(event))


def test_settings_run_the_hook_after_every_edit_tool() -> None:
    settings = json.loads((REPO / ".claude/settings.json").read_text(encoding="utf-8"))
    entries = settings["hooks"]["PostToolUse"]
    commands = [(entry["matcher"], hook["command"]) for entry in entries for hook in entry["hooks"]]
    assert ("Edit|Write|MultiEdit", f'"${{CLAUDE_PROJECT_DIR}}"/{HOOK}') in commands


def test_an_edit_over_the_cap_prints_the_failure_to_the_session(
    make_repo: Callable[..., Path],
) -> None:
    root = make_repo({"small.md": 10})
    write(root, "small.md", 20004)

    result = edit(root, root / "small.md")

    assert result.returncode == 2
    assert "file-size: small.md is ~5001 tokens (bytes/4); the limit is 5000." in result.stderr


def test_an_eighth_entry_prints_the_fan_out_failure(make_repo: Callable[..., Path]) -> None:
    root = make_repo({f"src/f{i}.md": 10 for i in range(7)})
    write(root, "src/f7.md", 10)

    result = edit(root, root / "src/f7.md")

    assert result.returncode == 2
    assert "fan-out: src holds 8 entries; the limit is 7." in result.stderr


def test_passing_ignored_and_deleted_files_stay_silent(make_repo: Callable[..., Path]) -> None:
    root = make_repo({".gitignore": 0, "a.md": 10})
    (root / ".gitignore").write_text("/vault/\n", encoding="utf-8")
    write(root, "vault/huge.md", 30000)
    index_before = (root / ".git/index").read_bytes()

    for path in (root / "a.md", root / "vault/huge.md", root / "gone.md"):
        result = edit(root, path)
        assert (result.returncode, result.stderr) == (0, ""), path

    # A new small file passes too, and none of these runs staged anything.
    write(root, "b.md", 10)
    assert edit(root, root / "b.md").returncode == 0
    assert (root / ".git/index").read_bytes() == index_before


def test_a_nested_repo_without_the_checks_stays_silent(make_repo: Callable[..., Path]) -> None:
    # vault/ is a colocated jj repo with its own .git and thousands of notes.
    root = make_repo({".gitignore": 0})
    (root / ".gitignore").write_text("/vault/\n", encoding="utf-8")
    for i in range(10):
        write(root, f"vault/notes/n{i}.md", 10)
    write(root, "vault/notes/big.md", 30000)
    git(root / "vault", "init", "-q")
    git(root / "vault", "add", ".")

    for name in ("n0.md", "big.md"):
        result = edit(root, root / "vault/notes" / name)
        assert (result.returncode, result.stderr) == (0, ""), name


def test_one_run_on_this_repo_takes_well_under_a_second() -> None:
    # The hook runs after every edit, so it must not make editing slow. About
    # 0.1 s here; the bound leaves room for a loaded CI runner.
    target = REPO / "backend/src/kasten_backend/main.py"
    start = time.monotonic()
    result = edit(REPO, target)
    elapsed = time.monotonic() - start

    assert result.returncode == 0, result.stderr
    assert elapsed < 2, f"editor-hook took {elapsed:.2f}s"
