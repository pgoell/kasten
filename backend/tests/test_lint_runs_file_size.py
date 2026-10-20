"""The CI Lint job runs the file-size check on every tracked file.

CI's lint job runs `mise run lint`, and lint must reach the no-argument
`scripts/file_size.py`, the one mode that checks every tracked file. The
pre-commit hook only sees staged files, so without this a file over the limit
could merge. The ci.yml check reads the text rather than parsing YAML, because
the backend env has no YAML parser as a direct dependency.
"""

import tomllib
from pathlib import Path

REPO = Path(__file__).parents[2]
FILE_SIZE_RUN = "python3 scripts/file_size.py"


def reached(tasks: dict[str, dict], name: str, found: set[str] | None = None) -> set[str]:
    found = set() if found is None else found
    found.add(name)
    # A missing task reads as empty, so the assert below names the gap instead of a KeyError.
    for dep in tasks.get(name, {}).get("depends", []):
        reached(tasks, dep, found)
    return found


def test_the_ci_lint_job_runs_the_file_size_check_on_every_tracked_file() -> None:
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    lint_job = ci.split("\n  lint:\n", 1)[1].split("\n  test:\n", 1)[0]
    assert any(line.strip() == "run: mise run lint" for line in lint_job.splitlines()), (
        "ci.yml: the lint job has no step running `mise run lint`, so CI never runs the lint tasks."
    )

    tasks = tomllib.loads((REPO / "mise.toml").read_text(encoding="utf-8"))["tasks"]
    runs = [tasks.get(name, {}).get("run") for name in reached(tasks, "lint")]
    assert FILE_SIZE_RUN in runs, (
        f"mise.toml: no task reached from [tasks.lint] runs `{FILE_SIZE_RUN}` (no arguments), "
        "so CI Lint never checks every tracked file. "
        "Add a task that runs it and depend on it from lint."
    )
