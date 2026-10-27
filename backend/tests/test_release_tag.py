"""The release-tag script, run against small git repos in tmp_path.

Each test builds its own repo with the tags it needs, so the verdict read is
the script's, not the tags of this repo.
"""

import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "scripts" / "check_release_tag.py"


def run(cwd: Path, tag: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT), tag],
        capture_output=True,
        text=True,
        cwd=cwd,
        check=False,
    )


def repo_with_tags(root: Path, *tags: str) -> None:
    git = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)  # noqa: S607
    # A tag needs a commit to point at.
    subprocess.run(  # noqa: S603
        [*git, "commit", "-q", "--allow-empty", "-m", "x"], cwd=root, check=True
    )
    for tag in tags:
        subprocess.run(["git", "tag", tag], cwd=root, check=True)  # noqa: S603, S607


def test_tag_above_the_last_release_passes(tmp_path: Path) -> None:
    repo_with_tags(tmp_path, "0.9.0", "0.10.0", "0.10.1")

    result = run(tmp_path, "0.10.1")

    assert result.returncode == 0
    assert result.stdout == "0.10.1 is a release number above 0.10.0\n"


def test_first_release_passes(tmp_path: Path) -> None:
    repo_with_tags(tmp_path, "0.1.0")

    result = run(tmp_path, "0.1.0")

    assert result.returncode == 0
    assert result.stdout == "0.1.0 is a release number, the first release\n"


@pytest.mark.parametrize(
    "tag", ["v1.2.3", "1.2", "1.2.3-rc.1", "01.2.3", "1.2.3.4", "1.2.3 ; echo"]
)
def test_malformed_tag_is_refused(tmp_path: Path, tag: str) -> None:
    repo_with_tags(tmp_path, "0.9.0")

    result = run(tmp_path, tag)

    assert result.returncode == 1
    assert "::error::" in result.stdout


@pytest.mark.parametrize(
    ("existing", "tag"),
    [
        # Lower patch.
        ("1.2.5", "1.2.4"),
        # Lower minor. As text "0.9.5" sorts above "0.10.0", so this also checks
        # that the numbers are compared as numbers.
        ("0.10.0", "0.9.5"),
    ],
)
def test_tag_not_above_the_last_release_is_refused(tmp_path: Path, existing: str, tag: str) -> None:
    repo_with_tags(tmp_path, existing)

    result = run(tmp_path, tag)

    assert result.returncode == 1
    assert f"::error::{tag} is not above {existing}" in result.stdout


def test_other_tag_shapes_are_ignored(tmp_path: Path) -> None:
    repo_with_tags(tmp_path, "v9.9.9", "nightly")

    result = run(tmp_path, "0.1.0")

    assert result.returncode == 0
    assert result.stdout == "0.1.0 is a release number, the first release\n"
