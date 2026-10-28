"""The import rules hold: the import-linter contracts, the dynamic-import bans and the lint task.

Each contract test copies the real source into tmp_path, adds one offender and checks that
lint-imports fails and names the contract. The real tree is never touched, so a failure here
means the config lost a rule, not that the repo drifted.
"""

import os
import re
import shutil
import subprocess
import sys
import tomllib
from typing import TYPE_CHECKING

from backend.tests.structure.repo import REPO, git, run

if TYPE_CHECKING:
    from pathlib import Path

LINT = str(REPO / ".venv/bin/lint-imports")
PYPROJECT = REPO / "pyproject.toml"
IGNORE = shutil.ignore_patterns("__pycache__", "fonts")
# Built in parts so this file never holds the text the dynamic-import grep bans.
NOQA = "noqa: TID" + "251"
BUILTIN = "__imp" + "ort__("


def contracts() -> list[dict]:
    config = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    return config.get("tool", {}).get("importlinter", {}).get("contracts", [])


def contract(kind: str, scope: str) -> str:
    """The name lint-imports prints for the contract of this type over this module."""
    for c in contracts():
        covered = c.get("modules", []) + c.get("protected_modules", []) + c.get("ancestors", [])
        if c["type"] == kind and scope in covered:
            return c["name"]
    raise AssertionError(f"pyproject.toml has no {kind} contract over {scope}")


def copy_tree(tmp_path: Path) -> Path:
    """Copy both packages and the root pyproject.toml into tmp_path, return the src folder."""
    src = tmp_path / "src"
    shutil.copytree(REPO / "backend/src/kasten_backend", src / "kasten_backend", ignore=IGNORE)
    shutil.copytree(REPO / "jobs/src/kasten_jobs", src / "kasten_jobs", ignore=IGNORE)
    shutil.copy(PYPROJECT, tmp_path / "pyproject.toml")
    return src


def assert_broken(tmp_path: Path, name: str) -> str:
    # PYTHONPATH comes before the venv's editable install, so the copy is the tree analysed.
    env = {k: v for k, v in os.environ.items() if not k.startswith(("LEFTHOOK", "GIT_"))}
    env["PYTHONPATH"] = str(tmp_path / "src")
    result = subprocess.run(  # noqa: S603
        [LINT, "--no-cache", "--no-logo", "--config", str(tmp_path / "pyproject.toml")],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    out = result.stdout + result.stderr
    assert result.returncode != 0, out
    # lint-imports wraps long names across lines, so compare them with the whitespace folded.
    assert " ".join(name.split()) in " ".join(out.split()), out
    return out


def append(path: Path, text: str) -> None:
    path.write_text(path.read_text(encoding="utf-8") + text, encoding="utf-8")


def test_the_repo_keeps_every_contract() -> None:
    result = run(REPO, LINT, "--no-cache", "--no-logo")
    assert result.returncode == 0, result.stdout + result.stderr


def test_a_job_importing_the_backend_fails(tmp_path: Path) -> None:
    src = copy_tree(tmp_path)
    (src / "kasten_jobs/zz_probe.py").write_text("import kasten_backend.config\n", encoding="utf-8")
    assert_broken(tmp_path, contract("independence", "kasten_jobs"))


def test_a_module_importing_a_router_fails(tmp_path: Path) -> None:
    src = copy_tree(tmp_path)
    (src / "kasten_backend/zz_probe.py").write_text(
        "import kasten_backend.routes.notes\n", encoding="utf-8"
    )
    assert_broken(tmp_path, contract("protected", "kasten_backend.routes"))


def test_a_new_router_import_beside_an_accepted_one_fails(tmp_path: Path) -> None:
    src = copy_tree(tmp_path)
    append(src / "kasten_backend/agent_finance.py", "\nimport kasten_backend.routes.notes\n")
    assert_broken(tmp_path, contract("protected", "kasten_backend.routes"))


def test_a_module_importing_main_fails(tmp_path: Path) -> None:
    src = copy_tree(tmp_path)
    (src / "kasten_backend/zz_probe.py").write_text(
        "import kasten_backend.main\n", encoding="utf-8"
    )
    assert_broken(tmp_path, contract("protected", "kasten_backend.main"))


def test_a_new_cycle_fails(tmp_path: Path) -> None:
    src = copy_tree(tmp_path)
    append(src / "kasten_backend/weather.py", "\nimport kasten_backend.vault\n")
    append(src / "kasten_backend/vault.py", "\nimport kasten_backend.weather\n")
    assert_broken(tmp_path, contract("acyclic_siblings", "kasten_backend"))


def test_a_stale_ignore_fails(tmp_path: Path) -> None:
    src = copy_tree(tmp_path)
    path = src / "kasten_backend/agent_finance.py"
    text = path.read_text(encoding="utf-8")
    cut = re.sub(r"from kasten_backend\.routes\.finance_sorting import \([^)]*\)\n", "", text)
    assert cut != text
    path.write_text(cut, encoding="utf-8")
    # A stale ignore has no contract line of its own; lint-imports names the pair instead.
    out = assert_broken(tmp_path, "No matches for ignored import")
    assert "kasten_backend.agent_finance -> kasten_backend.routes.finance_sorting" in " ".join(
        out.split()
    )


def test_the_accepted_breaches_stay_at_19() -> None:
    # Sorted, so the check does not depend on the order the contracts are written in.
    assert sorted(len(c.get("ignore_imports", [])) for c in contracts()) == [0, 0, 3, 16]
    for c in contracts():
        assert "unmatched_ignore_imports_alerting" not in c
        assert "allow_indirect_imports" not in c


def test_a_new_dynamic_import_fails_ruff(tmp_path: Path) -> None:
    probe = tmp_path / "probe.py"
    probe.write_text(
        '"""Probe."""\nimport importlib\nimport runpy\n\n'
        'importlib.import_module("os")\nrunpy.run_path("x.py")\n',
        encoding="utf-8",
    )
    out = subprocess.run(  # noqa: S603
        [
            sys.executable,
            "-m",
            "ruff",
            "check",
            "--no-cache",
            "--config",
            str(PYPROJECT),
            "--output-format",
            "concise",
            str(probe),
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    assert "TID251" in out
    assert "runpy" in out
    assert "No dynamic imports" in out


def test_the_accepted_dynamic_imports_stay_at_2() -> None:
    found = subprocess.run(  # noqa: S603
        ["git", "grep", "-n", NOQA, "--", "*.py"],  # noqa: S607
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    ).stdout
    assert len(found.splitlines()) == 2, found


def test_a_builtin___import___fails_the_grep(tmp_path: Path) -> None:
    tasks = tomllib.loads((REPO / "mise.toml").read_text(encoding="utf-8"))["tasks"]
    command = tasks["lint:imports"]["run"][2]
    git(tmp_path, "init", "-q")
    (tmp_path / "bad.py").write_text(f'x = {BUILTIN}"os")\n', encoding="utf-8")
    git(tmp_path, "add", ".")
    result = subprocess.run(  # noqa: S603
        ["bash", "-c", command],  # noqa: S607
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0, result.stdout + result.stderr


def test_lint_reaches_the_import_checks() -> None:
    tasks = tomllib.loads((REPO / "mise.toml").read_text(encoding="utf-8"))["tasks"]
    assert "lint:imports" in tasks["lint"]["depends"]
    assert any("lint-imports" in step for step in tasks["lint:imports"]["run"])
