"""The jj and rg pins, held together across the three files that carry them.

`mise.toml` pins the versions the host runs, and both Dockerfiles pin a version
and a checksum for the binary they lift into an image. Host and container work
on the same vault, so a drift here means one jj writing a repo another jj reads.

The repo is what this tests, not the app, so nothing is imported from
`kasten_backend`. The files are read as text and the pins pulled out with a
regular expression, which is also why the Dockerfiles have to spell the two
stages the same way.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

MISE = (ROOT / "mise.toml").read_text()
BACKEND = (ROOT / "backend" / "Dockerfile").read_text()
SHELL = (ROOT / "shell" / "Dockerfile").read_text()


def arg(dockerfile: str, name: str) -> str:
    """One `ARG NAME=value` line's value, and a loud failure when it is missing."""
    found = re.search(rf"^ARG {name}=(\S+)$", dockerfile, re.MULTILINE)
    assert found is not None, f"no ARG {name}"
    return found.group(1)


def mise_tool(entry: str) -> str:
    """The version mise pins a tool at. Versions only; mise carries no checksums."""
    found = re.search(rf'^"{re.escape(entry)}" = "(\S+)"$', MISE, re.MULTILINE)
    assert found is not None, f"no mise entry for {entry}"
    return found.group(1)


def test_jj_is_one_version_everywhere() -> None:
    version = mise_tool("ubi:jj-vcs/jj")
    assert arg(BACKEND, "JJ_VERSION") == version
    assert arg(SHELL, "JJ_VERSION") == version


def test_rg_is_one_version_everywhere() -> None:
    version = mise_tool("aqua:BurntSushi/ripgrep")
    assert arg(BACKEND, "RG_VERSION") == version
    assert arg(SHELL, "RG_VERSION") == version


def test_the_two_images_fetch_the_same_binaries() -> None:
    """Same version and a different checksum would be a fetch nobody noticed."""
    assert arg(SHELL, "JJ_SHA256") == arg(BACKEND, "JJ_SHA256")
    assert arg(SHELL, "RG_SHA256") == arg(BACKEND, "RG_SHA256")
