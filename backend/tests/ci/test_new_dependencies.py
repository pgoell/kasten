"""The new-dependency check, run against a throwaway repo and file:// registries.

Each test commits the base lockfiles in tmp_path, writes the pull request's
lockfiles over them, and serves the registries' JSON from files, so no test
reaches the network.
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

SCRIPT = Path(__file__).parents[3] / ".github" / "deps" / "new_dependencies.py"

UV_BASE = """version = 1

[[package]]
name = "kasten-backend"
version = "0.0.0"
source = { editable = "backend" }

[[package]]
name = "httpx"
version = "0.28.1"
source = { registry = "https://pypi.org/simple" }
"""
BUN_BASE = """{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "kasten-frontend",
    },
  },
  "packages": {
    "react": ["react@19.2.0", "", {}, "sha512-a"],
  }
}
"""


class Check(NamedTuple):
    returncode: int
    summary: str
    errors: list[str]


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)  # noqa: S603, S607


def uv_package(name: str, version: str) -> str:
    return f'\n[[package]]\nname = "{name}"\nversion = "{version}"\nsource = {{ registry = "x" }}\n'


def bun_package(name: str, version: str) -> str:
    return f'    "{name}": ["{name}@{version}", "", {{}}, "sha512-b"],\n'


def serve(root: Path, path: str, body: dict) -> None:
    (root / path).parent.mkdir(parents=True, exist_ok=True)
    (root / path).write_text(json.dumps(body), encoding="utf-8")


def pypi(root: Path, name: str, version: str, **info: object) -> None:
    serve(root, f"pypi/{name}/{version}/json", {"info": {"classifiers": [], **info}})
    latest = [{"upload_time_iso_8601": "2026-10-01T12:00:00Z"}]
    serve(root, f"pypi/{name}/json", {"info": {"version": version}, "urls": latest})


def npm(root: Path, name: str, version: str, licence: object) -> None:
    serve(
        root,
        f"npm/{name}",
        {
            "dist-tags": {"latest": version},
            "versions": {version: {"license": licence}},
            "time": {version: "2026-09-01T00:00:00Z"},
        },
    )


def run_check(tmp_path: Path, *, uv: str = "", bun: str = "") -> Check:
    repo = tmp_path / "repo"
    (repo / "frontend").mkdir(parents=True)
    (repo / "uv.lock").write_text(UV_BASE, encoding="utf-8")
    (repo / "frontend/bun.lock").write_text(BUN_BASE, encoding="utf-8")
    git(repo, "init", "-q")
    git(repo, "add", ".")
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base")
    (repo / "uv.lock").write_text(UV_BASE + uv, encoding="utf-8")
    head = BUN_BASE.replace('  "packages": {\n', '  "packages": {\n' + bun)
    (repo / "frontend/bun.lock").write_text(head, encoding="utf-8")

    summary = tmp_path / "summary.md"
    registries = ["--pypi", (tmp_path / "pypi").as_uri(), "--npm", (tmp_path / "npm").as_uri()]
    done = subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT), "HEAD", *registries],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
        env={"PATH": "/usr/bin:/bin", "GITHUB_STEP_SUMMARY": str(summary)},
    )
    errors = [line for line in done.stdout.splitlines() if line.startswith("::error::")]
    return Check(done.returncode, summary.read_text(encoding="utf-8"), errors)


def test_no_new_package_passes_and_says_so(tmp_path: Path) -> None:
    result = run_check(tmp_path)
    assert result.returncode == 0
    assert "adds no package" in result.summary


def test_new_packages_are_listed_with_licence_and_latest_release(tmp_path: Path) -> None:
    pypi(tmp_path, "anyio", "4.6.0", license_expression="MIT")
    npm(tmp_path, "@scope/thing", "1.2.3", "(MIT OR Apache-2.0)")
    result = run_check(
        tmp_path, uv=uv_package("anyio", "4.6.0"), bun=bun_package("@scope/thing", "1.2.3")
    )
    assert result.returncode == 0, result.errors
    assert "| pypi anyio | 4.6.0 | MIT | 2026-10-01 | yes |" in result.summary
    assert "| npm @scope/thing | 1.2.3 | (MIT OR Apache-2.0) | 2026-09-01 | yes |" in result.summary
    # Packages the base already had are not new.
    assert "httpx" not in result.summary
    assert "react" not in result.summary


def test_the_licence_comes_from_classifiers_before_the_free_text(tmp_path: Path) -> None:
    classifiers = ["License :: OSI Approved :: BSD License"]
    pypi(tmp_path, "old", "1.0", classifiers=classifiers, license="The whole\nlicence text")
    pypi(tmp_path, "older", "2.0", license="Apache License 2.0")
    npm(tmp_path, "legacy", "0.1.0", {"type": "ISC", "url": "x"})
    uv = uv_package("old", "1.0") + uv_package("older", "2.0")
    result = run_check(tmp_path, uv=uv, bun=bun_package("legacy", "0.1.0"))
    assert result.returncode == 0, result.errors
    assert "| pypi old | 1.0 | BSD |" in result.summary
    assert "| pypi older | 2.0 | Apache-2.0 |" in result.summary
    assert "| npm legacy | 0.1.0 | ISC |" in result.summary


def test_a_licence_outside_the_allowlist_fails_naming_the_package(tmp_path: Path) -> None:
    pypi(tmp_path, "copyleft", "3.0", license_expression="GPL-3.0-or-later")
    npm(tmp_path, "mixed", "1.0.0", "MIT AND GPL-2.0")
    result = run_check(
        tmp_path, uv=uv_package("copyleft", "3.0"), bun=bun_package("mixed", "1.0.0")
    )
    assert result.returncode == 1
    assert any("pypi copyleft" in e and "GPL-3.0-or-later" in e for e in result.errors)
    assert any("npm mixed" in e for e in result.errors)


def test_a_package_from_git_is_never_looked_up_on_pypi(tmp_path: Path) -> None:
    # PyPI has a project of the same name and version under a licence that passes.
    pypi(tmp_path, "forked", "1.0", license_expression="MIT")
    uv = '\n[[package]]\nname = "forked"\nversion = "1.0"\nsource = { git = "https://x" }\n'
    result = run_check(tmp_path, uv=uv)
    assert result.returncode == 1
    assert "| pypi forked | git | ? |" in result.summary
    assert any("pypi forked: no licence" in e for e in result.errors)


def test_a_licence_it_cannot_read_fails_naming_the_package(tmp_path: Path) -> None:
    pypi(tmp_path, "vague", "1.0", license="BSD-3-Clause, Apache-2.0, dependency licenses")
    # No npm document at all: the registry answers 404.
    result = run_check(tmp_path, uv=uv_package("vague", "1.0"), bun=bun_package("gone", "1.0.0"))
    assert result.returncode == 1
    assert any("pypi vague: no licence" in e for e in result.errors)
    assert any("npm gone: no licence" in e for e in result.errors)
