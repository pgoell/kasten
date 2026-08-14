"""What is running: the release in production, the commit in development."""

from importlib.metadata import version
from pathlib import Path

# The repo root when the backend runs from the tree, and a path that holds no
# `.git` when it runs from the wheel: production installs the package into
# `/app/.venv` and copies no repo beside it.
ROOT = Path(__file__).parents[3]


def build_id(root: Path = ROOT) -> str:
    """Name the code this process is running, in seven characters or a version.

    Read out of `.git` rather than run through `git`, which the image has not
    got, and read on every call rather than once: a dev container outlives the
    commits made under it.

    The release is the answer wherever the tree cannot be read, which covers
    production and a ref `git gc` has packed away.
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
