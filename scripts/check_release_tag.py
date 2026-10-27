"""Check that a release tag is a plain X.Y.Z number above every earlier release.

The deploy workflow runs this on the tag before anything is built. The tag is
the version the backend reports, because the image build writes it into the
package. A malformed or lower tag would ship a build that reports the wrong
version, and a lower tag would break `git describe` for the next release's
diff, which starts from the highest tag. The check compares the tag with the
other tags, since the backend no longer carries a version to compare it with.
"""

import re
import subprocess
import sys

# Digits only, no leading zeros, so 01.2.3 is refused and 1.2.3 is not. The
# ASCII flag keeps `\d` from matching other scripts' digits.
SHAPE = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", re.ASCII)


def parse(name: str) -> tuple[int, int, int] | None:
    """Return the numbers of a release tag, or None when the name is not one."""
    match = SHAPE.fullmatch(name)
    if match is None:
        return None
    major, minor, patch = match.groups()
    return int(major), int(minor), int(patch)


def main() -> int:
    """Print the verdict for the tag named on the command line and return the exit code."""
    args = sys.argv[1:]
    if len(args) != 1:
        sys.exit("usage: check_release_tag.py <tag>")
    tag = args[0]

    number = parse(tag)
    if number is None:
        print(
            f"::error::{tag} is not a release number. Use X.Y.Z: digits only, "
            "no leading zeros, no v, no suffix."
        )
        return 1

    names = subprocess.run(
        ["git", "tag", "--list"],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    # The tag itself already exists when this runs, so it is left out.
    earlier = sorted(
        (parsed, name) for name in names if name != tag and (parsed := parse(name)) is not None
    )

    if not earlier:
        print(f"{tag} is a release number, the first release")
        return 0

    last_number, last = earlier[-1]
    if number <= last_number:
        print(f"::error::{tag} is not above {last}, the last release.")
        return 1

    print(f"{tag} is a release number above {last}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
