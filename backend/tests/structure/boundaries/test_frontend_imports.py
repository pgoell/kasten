"""The frontend's import rules, run the way mise runs them, plus a probe per rule.

The first tests run the committed config against the real frontend, so a rule
dropped from .dependency-cruiser.cjs, or a stale known-violation entry, fails
here. Each probe copies the frontend's source into tmp_path, adds one offender
and checks that the rule it breaks fails the run. node_modules is symlinked, so
the copy needs no install and the real tree is never touched; the copy's config
keeps the symlink's path, or the accepted KaTeX entries would not match and
every probe would fail for the wrong reason.
"""

import json
import shlex
import shutil
import tomllib
from collections import Counter
from typing import TYPE_CHECKING

import pytest

from backend.tests.structure.repo import REPO, git, run

if TYPE_CHECKING:
    import subprocess
    from pathlib import Path

FRONTEND = REPO / "frontend"
KNOWN = FRONTEND / ".dependency-cruiser-known-violations.json"
COPIED = (
    "tsconfig.json",
    "tsconfig.node.json",
    ".dependency-cruiser.cjs",
    ".dependency-cruiser-known-violations.json",
)


def lint_command() -> list[str]:
    tasks = tomllib.loads((REPO / "mise.toml").read_text(encoding="utf-8"))["tasks"]
    (line,) = [line for line in tasks["lint:imports"]["run"] if "depcruise" in line]
    return shlex.split(line.removeprefix("cd frontend && "))


def baseline_command() -> list[str]:
    argv = lint_command()
    # --ignore-known would hide the entries this test is checking, so the baseline drops it.
    return [*argv[: argv.index("--ignore-known")], "--output-type", "baseline"]


def probe(tmp_path: Path, files: dict[str, str]) -> subprocess.CompletedProcess[str]:
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    for tree in ("src", "sw", "scripts"):
        shutil.copytree(FRONTEND / tree, frontend / tree)
    for name in COPIED:
        shutil.copy(FRONTEND / name, frontend / name)
    (frontend / "node_modules").symlink_to(FRONTEND / "node_modules")
    with (frontend / ".dependency-cruiser.cjs").open("a", encoding="utf-8") as config:
        config.write("module.exports.options.preserveSymlinks = true;\n")
    for name, source in files.items():
        (frontend / name).write_text(source, encoding="utf-8")
    return run(frontend, *lint_command())


def assert_fails(result: subprocess.CompletedProcess[str], rule: str, offender: str) -> None:
    output = result.stdout + result.stderr
    assert result.returncode != 0, output
    assert f"{rule}: {offender}" in output, output


def rule_names(violations: list[dict]) -> Counter[str]:
    return Counter(violation["rule"]["name"] for violation in violations)


def canonical(violations: list[dict]) -> list[str]:
    return sorted(json.dumps(violation, sort_keys=True) for violation in violations)


def test_the_frontend_passes_its_rules() -> None:
    result = run(FRONTEND, *lint_command())
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_known_violations_are_exactly_todays() -> None:
    result = run(FRONTEND, *baseline_command())
    assert result.returncode == 0, result.stderr
    today = json.loads(result.stdout)
    committed = json.loads(KNOWN.read_text(encoding="utf-8"))
    # --ignore-known skips a stale entry without a word, so the file must match today exactly.
    assert canonical(committed) == canonical(today)


def test_the_known_violations_count_is_27() -> None:
    committed = json.loads(KNOWN.read_text(encoding="utf-8"))
    assert len(committed) == 27
    assert rule_names(committed) == {"no-circular": 14, "lib-not-up": 8, "no-dynamic-import": 5}


def test_the_rules_scan_src_sw_and_scripts() -> None:
    assert lint_command()[1:4] == ["src", "sw", "scripts"]


def test_an_untouched_copy_passes(tmp_path: Path) -> None:
    # The control for every probe below: without the offender, the copy is clean.
    result = probe(tmp_path, {})
    assert result.returncode == 0, result.stdout + result.stderr


def test_a_new_cycle_fails(tmp_path: Path) -> None:
    result = probe(
        tmp_path,
        {
            "src/lib/zz-probe-a.ts": 'import "./zz-probe-b";\nexport const a = 1;\n',
            "src/lib/zz-probe-b.ts": 'import "./zz-probe-a";\nexport const b = 2;\n',
        },
    )
    assert_fails(result, "no-circular", "src/lib/zz-probe-")


def test_lib_importing_a_component_fails(tmp_path: Path) -> None:
    result = probe(
        tmp_path,
        {"src/lib/zz-probe.ts": 'import "@/components/editor";\nexport const probe = 1;\n'},
    )
    assert_fails(result, "lib-not-up", "src/lib/zz-probe.ts")


def test_a_component_importing_a_route_fails(tmp_path: Path) -> None:
    result = probe(
        tmp_path,
        {"src/components/zz-probe.tsx": 'import "@/routes/index";\nexport const probe = 1;\n'},
    )
    assert_fails(result, "components-not-routes", "src/components/zz-probe.tsx")


def test_the_lists_app_importing_lib_fails(tmp_path: Path) -> None:
    result = probe(
        tmp_path,
        {"src/lists/zz-probe.ts": 'import "@/lib/fuzzy";\nexport const probe = 1;\n'},
    )
    assert_fails(result, "lists-apart", "src/lists/zz-probe.ts")


def test_the_notebook_importing_the_lists_app_fails(tmp_path: Path) -> None:
    result = probe(
        tmp_path,
        {"src/lib/zz-probe.ts": 'import "@/lists/lists-store";\nexport const probe = 1;\n'},
    )
    assert_fails(result, "notebook-not-lists", "src/lib/zz-probe.ts")


def test_a_new_dynamic_import_fails(tmp_path: Path) -> None:
    result = probe(
        tmp_path,
        {"src/lib/zz-probe.ts": 'export const x = () => import("@/lib/fuzzy");\n'},
    )
    assert_fails(result, "no-dynamic-import", "src/lib/zz-probe.ts → src/lib/fuzzy.ts")


def test_a_new_dynamic_import_beside_an_accepted_one_fails(tmp_path: Path) -> None:
    # math.ts already holds an accepted dynamic import (KaTeX), so only the new line can fail.
    math = (FRONTEND / "src/lib/math.ts").read_text(encoding="utf-8")
    result = probe(
        tmp_path,
        {"src/lib/math.ts": math + '\nexport const later = () => import("@/lib/fuzzy");\n'},
    )
    assert_fails(result, "no-dynamic-import", "src/lib/math.ts → src/lib/fuzzy.ts")


def test_a_dynamic_import_in_the_service_worker_fails(tmp_path: Path) -> None:
    result = probe(
        tmp_path,
        {"sw/zz-probe.ts": 'export const x = () => import("@/lib/fuzzy");\n'},
    )
    assert_fails(result, "no-dynamic-import", "sw/zz-probe.ts → src/lib/fuzzy.ts")


@pytest.mark.parametrize(
    "source",
    ['const n = "./fuzzy";\nimport(n);\n', "import(`./${n}`);\n", 'import.meta.glob("./*.ts");\n'],
    ids=["a variable", "a template", "a glob"],
)
def test_a_dynamic_import_dependency_cruiser_cannot_follow_fails_the_grep(
    tmp_path: Path, source: str
) -> None:
    tasks = tomllib.loads((REPO / "mise.toml").read_text(encoding="utf-8"))["tasks"]
    (command,) = [step for step in tasks["lint:imports"]["run"] if "import\\.meta" in step]
    git(tmp_path, "init", "-q")
    (tmp_path / "frontend/src").mkdir(parents=True)
    (tmp_path / "frontend/src/zz-probe.ts").write_text(source, encoding="utf-8")
    (tmp_path / "frontend/src/ok.ts").write_text('import("./fuzzy");\n', encoding="utf-8")
    git(tmp_path, "add", ".")
    result = run(tmp_path, "bash", "-c", command)
    assert result.returncode != 0, result.stdout + result.stderr
    assert "zz-probe.ts" in result.stdout
    assert "ok.ts" not in result.stdout
