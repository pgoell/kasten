"""The CI main gate, run against a fake gh that serves canned API answers.

Each test writes its own answers, push payload and output files in tmp_path,
so the output read is the script's, not GitHub's.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, NamedTuple

SCRIPT = Path(__file__).parents[3] / "scripts" / "ci_main_gate.py"
REPO = "owner/repo"
SHA = "c1"
COMMITS = f"repos/{REPO}/commits/{SHA}"
PULLS = f"{COMMITS}/pulls"
ARTIFACTS = f"repos/{REPO}/actions/artifacts?name=ci-tested-tree-t1&per_page=100"
RUNS = f"repos/{REPO}/actions/workflows/ci.yml/runs?head_sha=h1&event=pull_request&per_page=100"
JOBS = f"repos/{REPO}/actions/runs/100/jobs?per_page=100"

FAKE_GH_BODY = """
import json
import os
import sys

responses = json.load(open(os.environ["FAKE_GH"], encoding="utf-8"))
path = sys.argv[2]
if path not in responses:
    sys.exit(1)
response = responses[path]
if isinstance(response, str):
    print(response)
elif isinstance(response, dict) and "exit" in response:
    sys.stderr.write("fake gh failure\\n")
    sys.exit(response["exit"])
else:
    print(json.dumps(response))
"""


class Gate(NamedTuple):
    returncode: int
    output: dict[str, str]
    summary: str


def artifact(run_id: int, head: str = "h1") -> dict[str, Any]:
    return {"workflow_run": {"id": run_id, "head_sha": head}}


def run(run_id: int, run_number: int, **changes: Any) -> dict[str, Any]:
    base = {
        "id": run_id,
        "run_number": run_number,
        "event": "pull_request",
        "path": ".github/workflows/ci.yml",
        "head_sha": "h1",
        "status": "completed",
        "conclusion": "success",
        "html_url": f"https://github.com/{REPO}/actions/runs/{run_id}",
    }
    return {**base, **changes}


def job(name: str, conclusion: str) -> dict[str, str]:
    return {"name": name, "conclusion": conclusion}


def happy() -> dict[str, Any]:
    return {
        COMMITS: {"commit": {"tree": {"sha": "t1"}}},
        PULLS: [
            {
                "number": 7,
                "merged_at": "2026-10-26T10:00:00Z",
                "merge_commit_sha": SHA,
                "base": {"ref": "main"},
                "head": {"sha": "h1"},
            }
        ],
        ARTIFACTS: {"artifacts": [artifact(100)]},
        RUNS: {"workflow_runs": [run(100, 5)]},
        JOBS: {"jobs": [job(name, "success") for name in ("Changes", "Lint", "Test", "Perf")]},
    }


def parse_output(text: str) -> dict[str, str]:
    return {key: value for key, _, value in (line.partition("=") for line in text.splitlines())}


def run_gate(
    tmp_path: Path,
    responses: dict[str, Any],
    *,
    event: str = "push",
    commits: int = 1,
    forced: bool = False,
) -> Gate:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text(f"#!{sys.executable}\n{FAKE_GH_BODY}", encoding="utf-8")
    gh.chmod(0o755)
    responses_file = tmp_path / "responses.json"
    responses_file.write_text(json.dumps(responses), encoding="utf-8")
    payload = tmp_path / "event.json"
    payload.write_text(
        json.dumps({"after": SHA, "forced": forced, "commits": [{}] * commits}), encoding="utf-8"
    )
    output = tmp_path / "output.txt"
    summary = tmp_path / "summary.md"
    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "FAKE_GH": str(responses_file),
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_SHA": SHA,
        "GITHUB_EVENT_NAME": event,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_PATH": str(payload),
        "GITHUB_OUTPUT": str(output),
        "GITHUB_STEP_SUMMARY": str(summary),
    }
    result = subprocess.run(  # noqa: S603
        [sys.executable, str(SCRIPT)],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    return Gate(
        result.returncode,
        parse_output(output.read_text(encoding="utf-8")) if output.exists() else {},
        summary.read_text(encoding="utf-8") if summary.exists() else "",
    )


def test_single_commit_of_a_green_pull_request_skips(tmp_path: Path) -> None:
    result = run_gate(tmp_path, happy())

    assert result.returncode == 0
    assert result.output["skip"] == "true"
    assert result.output["run_url"] == f"https://github.com/{REPO}/actions/runs/100"
    assert result.summary.startswith("Skipped Lint, Test and Perf")
    assert "tree t1" in result.summary
    assert "PR #7" in result.summary
    assert f"https://github.com/{REPO}/actions/runs/100" in result.summary


def test_artifact_from_another_pull_request_head_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[ARTIFACTS] = {"artifacts": [artifact(100, head="other")]}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_no_artifact_for_the_tree_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[ARTIFACTS] = {"artifacts": []}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_newest_run_failed_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[RUNS] = {"workflow_runs": [run(100, 5, conclusion="failure")]}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_newest_run_cancelled_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[RUNS] = {"workflow_runs": [run(100, 5, conclusion="cancelled")]}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_newest_run_still_running_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[RUNS] = {"workflow_runs": [run(100, 5, status="in_progress", conclusion=None)]}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_older_green_run_does_not_outrank_newer_failed_run(tmp_path: Path) -> None:
    responses = happy()
    responses[ARTIFACTS] = {"artifacts": [artifact(99), artifact(100)]}
    responses[RUNS] = {
        "workflow_runs": [run(99, 4), run(100, 5, conclusion="failure")],
    }

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_newest_run_from_another_workflow_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[RUNS] = {"workflow_runs": [run(100, 5, path=".github/workflows/other.yml")]}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_skipped_test_job_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[JOBS] = {
        "jobs": [job("Lint", "success"), job("Test", "skipped"), job("Perf", "success")]
    }

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_missing_lint_job_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[JOBS] = {"jobs": [job("Test", "success"), job("Perf", "success")]}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_commit_without_merged_pull_request_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[PULLS] = []

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"
    assert result.summary == "Full run: no merged pull request for this commit\n"


def test_pull_request_merged_into_another_base_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[PULLS][0]["base"] = {"ref": "release"}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_pull_request_event_runs_full(tmp_path: Path) -> None:
    result = run_gate(tmp_path, happy(), event="pull_request")

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_push_of_two_commits_runs_full(tmp_path: Path) -> None:
    result = run_gate(tmp_path, happy(), commits=2)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_forced_push_runs_full(tmp_path: Path) -> None:
    result = run_gate(tmp_path, happy(), forced=True)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_gh_failure_on_artifacts_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[ARTIFACTS] = {"exit": 1}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"
    assert result.summary.startswith("Full run: GitHub API error")


def test_malformed_json_from_commit_call_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[COMMITS] = "{not json"

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"


def test_tree_without_an_artifact_runs_full(tmp_path: Path) -> None:
    responses = happy()
    responses[COMMITS] = {"commit": {"tree": {"sha": "t2"}}}

    result = run_gate(tmp_path, responses)

    assert result.returncode == 0
    assert result.output["skip"] == "false"
