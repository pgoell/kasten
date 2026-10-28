"""CI's Lint job runs both structure checks on the whole repo.

CI's lint job runs `mise run lint`, and lint must reach the bare file-size run
and the `--all` fan-out run, the modes that check the whole repo. The
pre-commit hook only sees staged files, so without these an oversized file or
folder could merge. The ci.yml checks read the text rather than parsing YAML,
because the backend env has no YAML parser as a direct dependency. The ruff
structure rules (complexity, argument count, relative imports) get the same
proof: each must still fail on new growth, against the repo's real pyproject.toml.
"""

import re
import shutil
import subprocess
import sys
import tomllib
from collections import Counter
from typing import TYPE_CHECKING

import pytest

from backend.tests.structure.repo import REPO

if TYPE_CHECKING:
    from pathlib import Path

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


NOQA = "# noqa: TID252"
RUFF = [sys.executable, "-m", "ruff", "check", "--no-cache"]
# The relative imports there when the ban came in, as ruff counts them: one hit per name.
ACCEPTED_RELATIVE_IMPORTS = {
    "backend/tests/test_finance_sync.py": 5,
    "jobs/tests/test_bank_sync.py": 8,
    "jobs/tests/test_bookings.py": 7,
    "jobs/tests/test_order_mails.py": 12,
    "jobs/tests/test_order_sync.py": 8,
    "jobs/tests/test_order_sync_failures.py": 6,
}
RULE_LINE = re.compile(r":\d+:\d+: [A-Z]+\d+ ")
PATHS = [
    "backend/src/kasten_backend/new.py",
    "jobs/src/kasten_jobs/new.py",
    # Tests and alembic have per-file-ignores, so offenders there must still fail.
    "backend/tests/test_new.py",
    "jobs/tests/test_new.py",
    "backend/alembic/versions/new.py",
    "scripts/new.py",
]


def ruff(tmp_path: Path, files: dict[str, str]) -> list[str]:
    shutil.copy(REPO / "pyproject.toml", tmp_path / "pyproject.toml")
    for name, source in files.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(source, encoding="utf-8")
    out = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--no-cache", "--output-format", "concise", "."],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    return [line for line in out.splitlines() if RULE_LINE.search(line)]


def branchy(count: int) -> str:
    body = "".join(f"    if x == {n}:\n        y += {n}\n" for n in range(1, count + 1))
    head = 'def busy(x: int) -> int:\n    """Add the matching number."""\n    y = 0\n'
    return head + body + "    return y\n"


@pytest.mark.parametrize("path", PATHS)
def test_a_function_over_complexity_10_fails(tmp_path: Path, path: str) -> None:
    found = ruff(tmp_path, {path: branchy(10)})  # ten ifs plus the function is complexity 11
    assert any(f"{path}:" in line and " C901 " in line for line in found)


@pytest.mark.parametrize("path", PATHS)
def test_a_function_of_complexity_10_passes_c901(tmp_path: Path, path: str) -> None:
    found = ruff(tmp_path, {path: branchy(9)})  # nine ifs plus the function is complexity 10
    assert not any(" C901 " in line for line in found)


@pytest.mark.parametrize("path", PATHS)
def test_a_function_of_six_arguments_fails(tmp_path: Path, path: str) -> None:
    source = (
        "def f(a: int, b: int, c: int, d: int, e: int, g: int) -> int:\n"
        '    """Sum."""\n    return a + b + c + d + e + g\n'
    )
    found = ruff(tmp_path, {path: source})
    assert any(f"{path}:" in line and " PLR0913 " in line for line in found)


@pytest.mark.parametrize("path", PATHS)
def test_a_function_of_five_arguments_passes_plr0913(tmp_path: Path, path: str) -> None:
    source = (
        "def f(a: int, b: int, c: int, d: int, e: int) -> int:\n"
        '    """Sum."""\n    return a + b + c + d + e\n'
    )
    found = ruff(tmp_path, {path: source})
    assert not any(" PLR0913 " in line for line in found)


@pytest.mark.parametrize("path", PATHS)
def test_every_relative_import_fails(tmp_path: Path, path: str) -> None:
    source = "from .sibling import name\nfrom . import other\nfrom ..parent import thing\n"
    found = ruff(tmp_path, {path: source})
    for line in (1, 2, 3):
        assert any(
            f"{path}:{line}:" in found_line and " TID252 " in found_line for found_line in found
        )


def test_a_new_relative_import_beside_an_accepted_one_fails(tmp_path: Path) -> None:
    source = f"from .a import b  {NOQA}\nfrom .c import d\n"
    found = [
        line for line in ruff(tmp_path, {"jobs/tests/test_new.py": source}) if " TID252 " in line
    ]
    assert len(found) == 1
    assert found[0].startswith("jobs/tests/test_new.py:2:")


def test_no_per_file_ignore_drops_the_structure_rules() -> None:
    ruff_config = tomllib.loads((REPO / "pyproject.toml").read_text(encoding="utf-8"))["tool"][
        "ruff"
    ]
    lint = ruff_config["lint"]
    widened = []
    for table in ("per-file-ignores", "extend-per-file-ignores"):
        for codes in lint.get(table, {}).values():
            widened.extend(codes)
    widened.extend(lint.get("ignore", []) + lint.get("extend-ignore", []))
    for code in widened:
        for rule in ("TID252", "C901", "PLR0913"):
            assert not rule.startswith(code), f"pyproject.toml ignores {code}, which drops {rule}"
    assert lint.get("mccabe", {}).get("max-complexity") == 10
    assert lint.get("flake8-tidy-imports", {}).get("ban-relative-imports") == "all"


def test_the_accepted_relative_imports_do_not_grow() -> None:
    # --ignore-noqa, so neither a bare noqa nor a file-wide ruff noqa can hide a new one. Ruff
    # reports one hit per imported name, so a name added to an accepted line counts as growth,
    # and an exact match catches a lower count from a config that loosens the rule.
    out = subprocess.run(  # noqa: S603
        [*RUFF, "--ignore-noqa", "--select", "TID252", "--output-format", "concise", "."],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    found = Counter(line.split(":", 1)[0] for line in out.splitlines() if " TID252 " in line)
    assert found == ACCEPTED_RELATIVE_IMPORTS, (
        "relative imports differ from the ones accepted when the ban came in; a new one must "
        "import by package name, and a fixed one comes off ACCEPTED_RELATIVE_IMPORTS"
    )


def test_no_other_ruff_config_or_exclude_loosens_the_rules() -> None:
    configs = subprocess.run(
        ["git", "ls-files", "*ruff.toml", "*pyproject.toml"],  # noqa: S607
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    with_ruff = [
        name
        for name in configs
        if name.endswith("ruff.toml")
        or "ruff" in tomllib.loads((REPO / name).read_text(encoding="utf-8")).get("tool", {})
    ]
    assert with_ruff == ["pyproject.toml"]
    ruff_config = tomllib.loads((REPO / "pyproject.toml").read_text(encoding="utf-8"))["tool"][
        "ruff"
    ]
    assert "exclude" not in ruff_config
    assert ruff_config.get("extend-exclude") == ["backend/alembic/script.py.mako"]


def test_the_repo_passes_ruff() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--no-cache", "."],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout


def test_lint_reaches_ruff_check() -> None:
    tasks = tomllib.loads((REPO / "mise.toml").read_text(encoding="utf-8"))["tasks"]
    runs = [tasks.get(name, {}).get("run") for name in reached(tasks, "lint")]
    texts = [" ".join(run) if isinstance(run, list) else str(run) for run in runs]
    assert any("uv run ruff check" in text for text in texts), (
        "no task reached from [tasks.lint] runs ruff check"
    )
