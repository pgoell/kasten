#!/usr/bin/env python3
"""Publish the next release, its number computed from the commits.

A release is one command at the tip of origin/main, with no version bump pull request. The
version lives in the tag, so this script reads the Conventional Commits since
the last X.Y.Z tag, picks the bump they call for, and creates the GitHub
release at HEAD. Publishing the release is what deploys it.
"""

import argparse
import re
import subprocess
import sys

Version = tuple[int, int, int]

TAG = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
SUBJECT = re.compile(r"^(\w+)(\([^)]*\))?(!)?: ")
# GitHub's revert button writes `Revert "feat: x"`, not a Conventional Commit.
# Undoing shipped code changes what runs, so it is a patch like `revert:`.
GITHUB_REVERT = re.compile(r'^Revert "')
BREAKING_FOOTER = re.compile(r"^BREAKING[ -]CHANGE:", re.MULTILINE)
PATCH_TYPES = {"fix", "perf", "refactor", "build", "revert"}

NONE, PATCH, MINOR, MAJOR = 0, 1, 2, 3


def git(*args: str) -> str:
    """Run git in the working directory and return its stripped stdout."""
    result = subprocess.run(  # noqa: S603
        ["git", *args],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def fmt(version: Version) -> str:
    """Write a version as X.Y.Z."""
    return ".".join(map(str, version))


def last_release() -> Version | None:
    """Return the highest X.Y.Z tag, or None when there is none."""
    tags = git("tag", "--list").split()
    found: list[Version] = [(int(m[1]), int(m[2]), int(m[3])) for t in tags if (m := TAG.match(t))]
    return max(found, default=None)


def commit_messages(last: Version | None) -> list[str]:
    """Return the full messages of the commits since the last tag, or all of them."""
    rev = "HEAD" if last is None else f"{fmt(last)}..HEAD"
    records = git("log", "--format=%B%x1e", rev).split("\x1e")
    return [r.strip() for r in records if r.strip()]


def bump_for(message: str) -> int:
    """Return how far one commit message bumps the version."""
    subject = message.splitlines()[0]
    if GITHUB_REVERT.match(subject):
        return PATCH
    match = SUBJECT.match(subject)
    if match is None:
        return NONE
    kind, bang = match.group(1), match.group(3)
    if bang or BREAKING_FOOTER.search(message):
        return MAJOR
    if kind == "feat":
        return MINOR
    if kind in PATCH_TYPES:
        return PATCH
    return NONE


def next_version(last: Version | None) -> Version | None:
    """Return the next version, or None when nothing is releasable."""
    bump = max((bump_for(m) for m in commit_messages(last)), default=NONE)
    if bump == NONE:
        return None
    major, minor, patch = last or (0, 0, 0)
    if bump == MAJOR:
        return (major + 1, 0, 0)
    if bump == MINOR:
        return (major, minor + 1, 0)
    return (major, minor, patch + 1)


def is_ancestor(older: str, newer: str) -> bool:
    """Return True when the commit `older` is reachable from `newer`."""
    result = subprocess.run(  # noqa: S603
        ["git", "merge-base", "--is-ancestor", older, newer],  # noqa: S607
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def check_guards() -> None:
    """Refuse unless HEAD is the clean tip of origin/main, on a branch or detached."""
    if git("status", "--porcelain"):
        raise SystemExit("release: working tree is not clean")
    # Fetch before comparing, so origin/main is the one on GitHub right now.
    git("fetch", "--tags", "origin")
    head = git("rev-parse", "HEAD")
    tip = git("rev-parse", "origin/main")
    if head == tip:
        return
    if is_ancestor(head, tip):
        raise SystemExit("release: HEAD is behind origin/main; fetch and check out origin/main")
    if is_ancestor(tip, head):
        raise SystemExit(
            "release: HEAD is ahead of origin/main; merge it through a pull request first"
        )
    raise SystemExit("release: HEAD has diverged from origin/main; check out origin/main")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    """Read the command line."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the next version and create nothing",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Publish the next release and print its version."""
    args = parse_args(argv)
    if not args.dry_run:
        check_guards()
    last = last_release()
    version = next_version(last)
    if version is None:
        base = fmt(last) if last else "0.0.0"
        print(f"nothing to release since {base}", file=sys.stderr)
        return 0
    text = fmt(version)
    if not args.dry_run:
        # gh prints the release URL on stdout; send it to stderr so stdout
        # carries the version alone.
        cmd = ["gh", "release", "create", text, "--target", git("rev-parse", "HEAD")]
        subprocess.run(  # noqa: S603
            [*cmd, "--generate-notes"],
            stdout=sys.stderr,
            check=True,
        )
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
