"""List the authored files that pass the 5,000-token limit.

A token here is four bytes. That is close enough for a guard and needs no
tokenizer. With no arguments the script checks every tracked file; with path
arguments it checks just those. It is not in lefthook or mise lint yet (#611).
"""

import subprocess
import sys
from pathlib import Path, PurePosixPath

LIMIT = 5000

# Only what no person or agent writes by hand. One plain list, no per-file
# allowances: a file that needs one should be split, not excused.
EXCLUDE = [
    "uv.lock",
    "bun.lock",
    "mise.lock",
    "frontend/src/lib/api-types.ts",
    "frontend/openapi.json",
    "frontend/src/routeTree.gen.ts",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.webp",
    "*.svg",
    "*.ico",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.otf",
    "*.pdf",
    "*.epub",
    "LICENSE",
]

ADVICE = """Big files cost agents: they read them in pieces and lose track. Do not fix this
by cutting the file into parts by line count, or by moving code into
pass-through wrappers, barrel files or a utils grab bag. That gives many
shallow modules, and a reader then has to open all of them.

Split along a deep module instead (John Ousterhout, "A Philosophy of Software
Design"): a module whose interface is small next to what it hides.
1. List what the file does. Find a group of functions that share state or
   knowledge the rest of the file does not need.
2. Move that group into its own module behind a few functions. Callers should
   not need to know how it works inside.
3. Check: if the new module's interface is nearly as big as its body, or every
   caller still reaches into its details, you picked the wrong line. Try again.
- Tests: split by the behaviour or module under test, one file per unit,
  shared fixtures in one helper.
- Docs: split by topic into a folder with an index page that links them.
- Data (word lists, fixtures): move it into a data file and add it to the
  exclude list, if no person or agent edits it by hand."""


def tracked_files() -> tuple[Path, list[str]]:
    """Return the repo root and every tracked path, relative to it."""
    # The script may run from any folder, so ask git where the repo is and
    # list from there. Paths then mean the same thing wherever it was started.
    root = Path(
        subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],  # noqa: S607
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    )
    listing = subprocess.run(
        ["git", "ls-files", "-z"],  # noqa: S607
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return root, [name for name in listing.split("\0") if name]


def excluded(name: str) -> bool:
    """Return whether any exclude glob matches the path."""
    return any(PurePosixPath(name).match(glob) for glob in EXCLUDE)


def main(argv: list[str]) -> int:
    """Print the files over the limit and return 1, or return 0 when none are."""
    if argv:
        base, names = Path.cwd(), argv
    else:
        base, names = tracked_files()

    over = []
    for name in names:
        if excluded(name):
            continue
        path = base / name
        # A file staged for deletion is still in the index but gone from disk.
        if not path.is_file():
            continue
        size = path.stat().st_size
        # Checked in bytes, not in the integer token count, so a file of
        # 20,001 to 20,003 bytes is over even though it rounds down to 5000.
        if size > LIMIT * 4:
            over.append((size // 4, name))

    if not over:
        return 0

    over.sort(key=lambda item: (-item[0], item[1]))
    for tokens, name in over:
        print(f"file-size: {name} is ~{tokens} tokens (bytes/4); the limit is {LIMIT}.")
    print()
    print(ADVICE)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
