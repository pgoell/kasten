"""What is running: the release in production, the commit in development."""

from importlib.metadata import version
from pathlib import Path

# The repo root from the tree. Production installs into `/app/.venv` with no repo
# beside it, so the path holds no `.git` there.
ROOT = Path(__file__).parents[3]


def build_id(root: Path = ROOT) -> str:
    """Name the running code: seven characters of commit, or else the release.

    Read from `.git` on every call: the image has no `git`, and a dev container
    outlives the commits made under it.
    """
    head = root / ".git" / "HEAD"
    if not head.is_file():
        return version("kasten-backend")

    named = head.read_text().strip()
    if named.startswith("ref: "):
        loose = root / ".git" / named.removeprefix("ref: ")
        if not loose.is_file():
            return version("kasten-backend")
        named = loose.read_text().strip()

    return named[:7]
