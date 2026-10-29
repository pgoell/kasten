"""List the packages a pull request adds to uv.lock and frontend/bun.lock.

Writes each new package's licence and latest release date, read from the
registry's own metadata (PyPI JSON, the npm registry), to the job summary, and
fails on a licence outside the allowlist of #1322 or one it cannot read. A
README badge is never read: it is whatever the author drew.

    python3 .github/deps/new_dependencies.py <base> [--pypi URL] [--npm URL]

<base> is the merge base; the lockfiles at HEAD's working tree are compared
with it. Runs on the runner's python3, so stdlib only.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

NOT_FOUND = 404
UV_LOCK = "uv.lock"
BUN_LOCK = "frontend/bun.lock"
ALLOWED = {"mit", "bsd", "apache-2.0", "isc", "postgresql", "mpl-2.0"}
ALLOWLIST = "MIT, BSD, Apache-2.0, ISC, PostgreSQL, MPL-2.0"
# The way past a licence the check cannot read or does not allow: a code owner
# reads it and adds "<kind> <name>": "<why>" here, in the pull request that adds it.
ACCEPTED: dict[str, str] = {}

# Trove classifiers, as PyPI lists them under "License :: OSI Approved :: ".
CLASSIFIERS = {
    "MIT License": "MIT",
    "BSD License": "BSD",
    "Apache Software License": "Apache-2.0",
    "ISC License (ISCL)": "ISC",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "PostgreSQL License": "PostgreSQL",
}
# Free-text names older packages put in `license`; anything longer is usually
# the whole licence text, which this does not try to read.
NAMES = {
    "mit license": "MIT",
    "bsd license": "BSD",
    "apache 2.0": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache license, version 2.0": "Apache-2.0",
    "apache software license": "Apache-2.0",
    "isc license": "ISC",
}
SPDX = re.compile(r"^\(?[A-Za-z0-9.+-]+( (AND|OR) [A-Za-z0-9.+-]+)*\)?$")
# One entry of bun.lock's "packages": `"key": ["name@version", ...`. bun.lock
# has trailing commas, so json cannot load it.
BUN_ENTRY = re.compile(r'^\s+"[^"]+": \["((?:@[^/"]+/)?[^@"]+)@([^"]+)"', re.MULTILINE)


def at_base(base: str, path: str) -> str:
    """Return the lockfile at the merge base, or "" when the base has none."""
    shown = subprocess.run(  # noqa: S603
        ["git", "show", f"{base}:{path}"],  # noqa: S607
        capture_output=True,
        text=True,
        check=False,
    )
    # A lockfile the base does not have yet: every package in it is new.
    return shown.stdout if shown.returncode == 0 else ""


def uv_packages(text: str) -> dict[str, str]:
    """Map each registry package in uv.lock to its version."""
    if not text:
        return {}
    packages = tomllib.loads(text).get("package", [])
    # The workspace's own members are editable or virtual, not from a registry.
    return {
        p["name"]: p["version"]
        for p in packages
        if not {"editable", "virtual"} & set(p.get("source", {}))
    }


def bun_packages(text: str) -> dict[str, str]:
    """Map each package in bun.lock to its version."""
    return dict(BUN_ENTRY.findall(text))


def fetch(url: str) -> dict | None:
    """Load a registry document, or None when the registry has none."""
    # Tests pass file:// registries, so the scheme is the caller's choice.
    try:
        with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == NOT_FOUND:
            return None
        raise
    except urllib.error.URLError as error:
        # A file:// registry's 404.
        if isinstance(error.reason, FileNotFoundError):
            return None
        raise


def from_text(text: str | None) -> str | None:
    """Read a licence field as an SPDX-like name, or None when it is not one."""
    text = (text or "").strip()
    if not text or "\n" in text:
        return None
    if text.lower() in NAMES:
        return NAMES[text.lower()]
    return text if SPDX.match(text) else None


def pypi_licence(info: dict) -> str | None:
    """Read a PyPI release's licence: the expression, the classifiers, then the field."""
    if info.get("license_expression"):
        return info["license_expression"]
    prefix = "License :: OSI Approved :: "
    found = [
        CLASSIFIERS.get(c.removeprefix(prefix), c.removeprefix(prefix))
        for c in info.get("classifiers", [])
        if c.startswith("License :: ")
    ]
    if found:
        # More than one licence classifier means a choice of licences.
        return " OR ".join(found)
    return from_text(info.get("license"))


def pypi(registry: str, name: str, version: str) -> tuple[str | None, str]:
    """Return the locked version's licence and the latest release's date."""
    pinned = fetch(f"{registry}/{name}/{version}/json")
    latest = fetch(f"{registry}/{name}/json")
    licence = pypi_licence(pinned["info"]) if pinned else None
    files = (latest or {}).get("urls") or [{}]
    date = files[0].get("upload_time_iso_8601", "")[:10] or "unknown"
    return licence, date


def npm(registry: str, name: str, version: str) -> tuple[str | None, str]:
    """Return the locked version's licence and the latest release's date."""
    doc = fetch(f"{registry}/{name}")
    if not doc:
        return None, "unknown"
    licence = doc.get("versions", {}).get(version, {}).get("license")
    # An old package.json may give {"type": "MIT", "url": ...}.
    if isinstance(licence, dict):
        licence = licence.get("type")
    latest = doc.get("dist-tags", {}).get("latest", "")
    date = doc.get("time", {}).get(latest, "")[:10] or "unknown"
    return from_text(licence if isinstance(licence, str) else None), date


def allowed(expression: str) -> bool:
    """Say whether a licence expression is on the allowlist."""
    ids = [i.strip("() ").lower() for i in re.split(r" (?:AND|OR) ", expression)]
    ok = [i in ALLOWED or i.startswith("bsd-") or i == "0bsd" for i in ids]
    # With an AND anywhere, read the whole as needing every licence: stricter
    # than SPDX for a mixed expression, never looser.
    return all(ok) if " AND " in expression else any(ok)


def check(rows: list[tuple[str, str, str, str | None, str]]) -> list[str]:
    """Write the summary table and return one error per package that fails."""
    errors = []
    lines = [
        "## New dependencies",
        "",
        "| Package | Version | Licence | Latest release | Allowed |",
        "| --- | --- | --- | --- | --- |",
    ]
    for kind, name, version, licence, date in rows:
        if f"{kind} {name}" in ACCEPTED:
            verdict = f"accepted: {ACCEPTED[f'{kind} {name}']}"
        elif licence is None:
            verdict = "no"
            errors.append(f"{kind} {name}: no licence in the registry's metadata")
        elif allowed(licence):
            verdict = "yes"
        else:
            verdict = "no"
            errors.append(f"{kind} {name}: licence {licence} is not one of {ALLOWLIST}")
        lines.append(f"| {kind} {name} | {version} | {licence or '?'} | {date} | {verdict} |")
    if not rows:
        lines[2:] = ["This pull request adds no package to uv.lock or frontend/bun.lock."]
    summary = "\n".join(lines) + "\n"
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as out:
            out.write(summary)
    return errors


def main() -> int:
    """List the new packages and fail on any that fails the check."""
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("--pypi", default="https://pypi.org/pypi")
    parser.add_argument("--npm", default="https://registry.npmjs.org")
    args = parser.parse_args()

    rows = []
    for kind, path, parse, look_up, registry in (
        ("pypi", UV_LOCK, uv_packages, pypi, args.pypi),
        ("npm", BUN_LOCK, bun_packages, npm, args.npm),
    ):
        new = parse(Path(path).read_text(encoding="utf-8"))
        old = parse(at_base(args.base, path))
        for name in sorted(new.keys() - old.keys()):
            rows.append((kind, name, new[name], *look_up(registry, name, new[name])))

    errors = check(rows)
    for error in errors:
        print(f"::error::{error}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
