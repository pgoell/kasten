#!/usr/bin/env python3
"""Decide whether the push to main can skip Lint, Backend, Test and Perf.

A squash merge lands the same tree that the pull request's last CI run tested,
so the push run would repeat that work. This gate skips only when every check
holds. Any doubt or error means a full run. It always exits 0, so a fault here
never fails the gate job; the worst outcome is a full run.
"""

# The runner's python3 is 3.12, which evaluates annotations eagerly; Mapping
# below is imported for the type checker only.
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Mapping

CI_PATH = ".github/workflows/ci.yml"
CHECKS = ("Lint", "Backend", "Test", "Perf")
NOT_A_PUSH = "not a single-commit push to main"


class GateStopError(Exception):
    """A check failed; the message is the reason for the full run."""


def gh(path: str) -> Any:
    """Call the GitHub API through gh and parse the JSON answer."""
    result = subprocess.run(  # noqa: S603
        ["gh", "api", path],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def check_push(env: Mapping[str, str], sha: str) -> None:
    """Stop unless this run is a single-commit push of sha to main."""
    if env["GITHUB_EVENT_NAME"] != "push" or env["GITHUB_REF"] != "refs/heads/main":
        raise GateStopError(NOT_A_PUSH)
    payload = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    if payload["forced"] is not False or payload["after"] != sha or len(payload["commits"]) != 1:
        raise GateStopError(NOT_A_PUSH)


def merged_pull(repo: str, sha: str) -> dict[str, Any]:
    """Return the one merged pull request into main that landed sha."""
    pulls = gh(f"repos/{repo}/commits/{sha}/pulls")
    merged = [
        pull
        for pull in pulls
        if pull["merged_at"] and pull["merge_commit_sha"] == sha and pull["base"]["ref"] == "main"
    ]
    if len(merged) != 1:
        raise GateStopError("no merged pull request for this commit")
    return merged[0]


def tested_run(repo: str, tree: str, pr_head: str) -> dict[str, Any]:
    """Return the newest pull_request CI run on pr_head, if it passed and uploaded the tree."""
    artifacts = gh(f"repos/{repo}/actions/artifacts?name=ci-tested-tree-{tree}&per_page=100")
    candidates = {
        artifact["workflow_run"]["id"]
        for artifact in artifacts["artifacts"]
        if artifact["workflow_run"]["head_sha"] == pr_head
    }
    if not candidates:
        raise GateStopError(f"no tested-tree artifact for head {pr_head}")
    runs = gh(
        f"repos/{repo}/actions/workflows/ci.yml/runs?head_sha={pr_head}&event=pull_request&per_page=100"
    )["workflow_runs"]
    if not runs:
        raise GateStopError(f"no pull_request CI run for head {pr_head}")
    newest = max(runs, key=lambda run: run["run_number"])
    state = newest["conclusion"] or newest["status"]
    qualifies = (
        newest["id"] in candidates
        and newest["event"] == "pull_request"
        and newest["path"] == CI_PATH
        and newest["head_sha"] == pr_head
        and newest["status"] == "completed"
        and newest["conclusion"] == "success"
    )
    if not qualifies:
        raise GateStopError(f"newest CI run {newest['html_url']} does not qualify ({state})")
    return newest


def verify(env: Mapping[str, str]) -> tuple[str, str]:
    """Return the skip line and the run url, or raise GateStopError."""
    repo, sha = env["GITHUB_REPOSITORY"], env["GITHUB_SHA"]
    check_push(env, sha)
    tree = gh(f"repos/{repo}/commits/{sha}")["commit"]["tree"]["sha"]
    pull = merged_pull(repo, sha)
    run = tested_run(repo, tree, pull["head"]["sha"])
    jobs = gh(f"repos/{repo}/actions/runs/{run['id']}/jobs?per_page=100")["jobs"]
    for check in CHECKS:
        if not any(job["name"] == check and job["conclusion"] == "success" for job in jobs):
            raise GateStopError(f"{check} did not pass in {run['html_url']}")
    line = (
        f"Skipped Lint, Backend, Test and Perf: tree {tree} of {sha} was tested by "
        f"PR #{pull['number']} run {run['html_url']}"
    )
    return line, run["html_url"]


def decide() -> tuple[bool, str, str]:
    """Return whether to skip, the summary line and the run url."""
    try:
        line, url = verify(os.environ)
    except GateStopError as reason:
        return False, f"Full run: {reason}", ""
    except (subprocess.CalledProcessError, OSError, ValueError, KeyError, TypeError) as error:
        return False, f"Full run: GitHub API error: {type(error).__name__}", ""
    return True, line, url


def write(var: str, text: str) -> None:
    """Append text to the file named by the env var, if it is set."""
    path = os.environ.get(var)
    if not path:
        return
    try:
        with Path(path).open("a", encoding="utf-8") as handle:
            handle.write(text)
    except OSError as error:
        print(f"could not write {var}: {error}", file=sys.stderr)


def main() -> int:
    """Print the decision and write it to the workflow outputs."""
    skip, line, url = decide()
    print(line)
    write("GITHUB_OUTPUT", f"skip=true\nrun_url={url}\n" if skip else "skip=false\n")
    write("GITHUB_STEP_SUMMARY", line + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
