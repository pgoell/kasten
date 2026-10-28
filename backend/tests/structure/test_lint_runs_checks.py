"""CI's Lint job runs both structure checks on the whole repo.

CI's lint job runs `mise run lint`, and lint must reach the bare file-size run
and the `--all` fan-out run, the modes that check the whole repo. The
pre-commit hook only sees staged files, so without these an oversized file or
folder could merge. The ci.yml checks read the text rather than parsing YAML,
because the backend env has no YAML parser as a direct dependency.
"""

import subprocess
import tomllib

from backend.tests.structure.repo import REPO

RUNS = ["scripts/structure/check-file-size", "scripts/structure/check-fan-out --all"]


def reached(tasks: dict[str, dict], name: str, found: set[str] | None = None) -> set[str]:
    found = set() if found is None else found
    found.add(name)
    # A missing task reads as empty, so the assert below names the gap instead of a KeyError.
    for dep in tasks.get(name, {}).get("depends", []):
        reached(tasks, dep, found)
    return found


def test_the_ci_lint_job_runs_both_checks_on_the_whole_repo() -> None:
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    lint_job = ci.split("\n  lint:\n", 1)[1].split("\n  test:\n", 1)[0]
    assert any(line.strip() == "run: mise run lint" for line in lint_job.splitlines())

    tasks = tomllib.loads((REPO / "mise.toml").read_text(encoding="utf-8"))["tasks"]
    runs = [tasks.get(name, {}).get("run") for name in reached(tasks, "lint")]
    for run in RUNS:
        assert run in runs, f"mise.toml: no task reached from [tasks.lint] runs `{run}`"


def test_the_required_checks_keep_their_names() -> None:
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "\n  lint:\n    name: Lint\n" in ci
    assert "\n  test:\n    name: Test\n" in ci


def test_the_scripts_are_committed_executable() -> None:
    listing = subprocess.run(
        ["git", "ls-files", "-s", "scripts/structure"],  # noqa: S607
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    modes = {line.split("\t")[1]: line.split()[0] for line in listing.splitlines()}
    assert set(modes) == {
        "scripts/structure/check-fan-out",
        "scripts/structure/check-file-size",
        "scripts/structure/editor-hook",
        "scripts/structure/structure-hook",
    }
    assert set(modes.values()) == {"100755"}


OLD_SCRIPT = "scripts/" + "file_size.py"  # split, so this file does not name it


def test_nothing_outside_the_log_names_the_old_script() -> None:
    found = subprocess.run(  # noqa: S603
        ["git", "grep", "-l", OLD_SCRIPT, "--", ".", ":!docs/log", ":!docs/log.md"],  # noqa: S607
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    assert found == ""
