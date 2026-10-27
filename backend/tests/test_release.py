"""The release script, run against small git repos in tmp_path.

Each test builds its own repo and a bare origin, so the output read is the
script's, not the state of this repo. The gh on PATH is a fake that logs its
arguments instead of publishing.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "scripts" / "release.py"


def git(cwd: Path, *args: str) -> str:
    result = subprocess.run(  # noqa: S603
        ["git", *args],  # noqa: S607
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def commit(repo: Path, message: str) -> None:
    git(repo, "commit", "-q", "--allow-empty", "-m", message)


def make_repo(tmp_path: Path, tags: tuple[str, ...] = ("0.4.2",)) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.name", "Test")
    git(repo, "config", "user.email", "test@example.com")
    git(repo, "config", "commit.gpgsign", "false")
    commit(repo, "chore: start")
    for tag in tags:
        git(repo, "tag", tag)
    install_fake_gh(tmp_path)
    return repo


def publish_remote(tmp_path: Path, repo: Path) -> None:
    # The guards compare HEAD with origin/main, so origin must hold main and tags.
    origin = tmp_path / "origin.git"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    git(repo, "remote", "add", "origin", str(origin))
    git(repo, "push", "-q", "origin", "main", "--tags")


def install_fake_gh(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text('#!/bin/sh\necho "$*" >> "$GH_LOG"\n', encoding="utf-8")
    gh.chmod(0o755)


def run_release(tmp_path: Path, repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "PATH": f"{tmp_path / 'bin'}{os.pathsep}{os.environ['PATH']}",
        "GH_LOG": str(tmp_path / "gh.log"),
    }
    return subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        cwd=repo,
        env=env,
        check=False,
    )


def gh_calls(tmp_path: Path) -> list[str]:
    log = tmp_path / "gh.log"
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def test_feat_is_a_minor_release(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    commit(repo, "feat: a")

    result = run_release(tmp_path, repo, "--dry-run")

    assert result.returncode == 0
    assert result.stdout == "0.5.0\n"


def test_fix_is_a_patch_release(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    commit(repo, "fix(x): a")

    result = run_release(tmp_path, repo, "--dry-run")

    assert result.returncode == 0
    assert result.stdout == "0.4.3\n"


def test_github_revert_is_a_patch_release(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    commit(repo, 'Revert "feat: add thing (#5)" (#6)')

    result = run_release(tmp_path, repo, "--dry-run")

    assert result.returncode == 0
    assert result.stdout == "0.4.3\n"


def test_perf_alone_is_a_patch_release(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    commit(repo, "perf: a")

    result = run_release(tmp_path, repo, "--dry-run")

    assert result.stdout == "0.4.3\n"


@pytest.mark.parametrize(
    "message",
    [
        "feat(x)!: a",
        "fix!: a",
        "fix: a\n\nBREAKING CHANGE: b",
    ],
)
def test_breaking_is_a_major_release(tmp_path: Path, message: str) -> None:
    repo = make_repo(tmp_path)
    commit(repo, message)

    result = run_release(tmp_path, repo, "--dry-run")

    assert result.returncode == 0
    assert result.stdout == "1.0.0\n"


@pytest.mark.parametrize("subject", ["docs: a", "test: a", "chore: a", "ci: a", "style: a"])
def test_nothing_releasable_makes_no_release(tmp_path: Path, subject: str) -> None:
    repo = make_repo(tmp_path)
    commit(repo, subject)
    publish_remote(tmp_path, repo)

    result = run_release(tmp_path, repo)

    assert result.returncode == 0
    assert result.stdout == ""
    assert "nothing to release since 0.4.2" in result.stderr
    assert gh_calls(tmp_path) == []


def test_last_tag_is_the_highest_release_tag(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, tags=("0.9.0", "0.10.0", "v9.9.9", "nightly"))
    commit(repo, "feat: a")

    result = run_release(tmp_path, repo, "--dry-run")

    assert result.stdout == "0.11.0\n"


def test_dry_run_prints_and_creates_nothing(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    git(repo, "checkout", "-q", "-b", "feature")
    (repo / "scratch.txt").write_text("dirty", encoding="utf-8")
    commit(repo, "feat: a")

    result = run_release(tmp_path, repo, "--dry-run")

    assert result.returncode == 0
    assert result.stdout == "0.5.0\n"
    assert gh_calls(tmp_path) == []


def test_release_publishes_from_the_head_it_read(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    publish_remote(tmp_path, repo)
    commit(repo, "feat: a")
    git(repo, "push", "-q", "origin", "main")
    head = git(repo, "rev-parse", "HEAD")

    result = run_release(tmp_path, repo)

    assert result.returncode == 0
    assert result.stdout == "0.5.0\n"
    assert gh_calls(tmp_path) == [f"release create 0.5.0 --target {head} --generate-notes"]


@pytest.mark.parametrize("drift", ["branch", "dirty", "ahead"])
def test_release_refuses_off_main_dirty_or_behind(tmp_path: Path, drift: str) -> None:
    repo = make_repo(tmp_path)
    publish_remote(tmp_path, repo)
    if drift == "branch":
        git(repo, "checkout", "-q", "-b", "feature")
    elif drift == "dirty":
        (repo / "scratch.txt").write_text("dirty", encoding="utf-8")
    else:
        commit(repo, "feat: a")

    result = run_release(tmp_path, repo)

    assert result.returncode == 1
    assert gh_calls(tmp_path) == []
