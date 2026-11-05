"""The weekly design review's script, run on a fixture git repo and fixture issue data.

Each test builds its own repo and data in tmp_path and passes --data, so nothing
reaches the network.
"""

import json
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parents[3]
SCRIPT = ROOT / ".github" / "review" / "design.py"
PROMPT = ROOT / ".github" / "review" / "design.md"
NOW = datetime(2026, 11, 2, 2, 15, tzinfo=UTC)
TODO = "frontend/src/lib/todo"
LOG = "frontend/src/lib/log"


def ago(days: float) -> str:
    return (NOW - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    return repo


def git(repo: Path, *args: str, date: str | None = None) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@t",
        "GIT_COMMITTER_NAME": "t",
    }
    env["GIT_COMMITTER_EMAIL"] = "t@t"
    if date:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = date
    subprocess.run(["git", *args], cwd=repo, env=env, check=True, capture_output=True)  # noqa: S603, S607


def commit(
    repo: Path, path: str, days: float, subject: str = "feat: change", size: int = 0
) -> None:
    file = repo / path
    file.parent.mkdir(parents=True, exist_ok=True)
    text = file.read_text() if file.exists() else ""
    file.write_text("x" * size if size else f"{text}{subject}\n")
    git(repo, "add", path)
    git(repo, "commit", "-q", "-m", subject, date=ago(days))


def issue(
    number: int, labels: list[str], days: float, body: str = "", **rest: Any
) -> dict[str, Any]:
    base = {"number": number, "title": f"issue {number}", "body": body, "state": "open"}
    return {**base, "labels": labels, "created_at": ago(days), **rest}


def run(
    tmp_path: Path, *args: str, data: dict[str, Any] | None = None
) -> subprocess.CompletedProcess[str]:
    data_file = tmp_path / "data.json"
    data_file.write_text(json.dumps(data or {"issues": [], "pulls": []}))
    command = [sys.executable, str(SCRIPT), *args, "--data", str(data_file), "--now", ago(0)]
    return subprocess.run(command, capture_output=True, text=True, check=True)  # noqa: S603


def pick(tmp_path: Path, repo: Path, data: dict[str, Any] | None = None) -> dict[str, Any]:
    out = tmp_path / "area.json"
    result = run(tmp_path, "pick", "--repo", str(repo), "--json", str(out), data=data)
    picked = json.loads(out.read_text())
    picked["report"] = result.stdout
    return picked


def counts(picked: dict[str, Any], area: str) -> dict[str, int]:
    return next(row for row in picked["areas"] if row["area"] == area)


def test_pick_counts_commits_per_area_over_seven_days(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    for days in (10, 11, 12, 13, 14):
        commit(repo, f"{LOG}/b.ts", days)
    commit(repo, f"{LOG}/b.ts", 2)
    commit(repo, f"{TODO}/a.ts", 1)
    commit(repo, f"{TODO}/a.ts", 3)
    picked = pick(tmp_path, repo)
    assert picked["area"] == TODO
    assert counts(picked, TODO)["commits"] == 2
    assert counts(picked, LOG)["commits"] == 1
    assert TODO in picked["report"]


def test_pick_counts_bug_and_regression_issues_per_area(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    commit(repo, f"{LOG}/lines.ts", 2)
    commit(repo, f"{TODO}/a.ts", 1)
    commit(repo, f"{TODO}/a.ts", 3)
    issues = [
        issue(1, ["bug"], 2, f"Breaks in {LOG}/lines.ts"),
        issue(2, ["regression"], 3, "lines.ts drops a line"),
        issue(3, ["wish"], 3, "lines.ts could do more"),
        issue(4, ["bug"], 10, "old bug in lines.ts"),
    ]
    picked = pick(tmp_path, repo, {"issues": issues, "pulls": []})
    assert picked["area"] == LOG
    assert counts(picked, LOG)["bugs"] == 2


def test_pick_lists_files_over_4500_tokens(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    commit(repo, f"{TODO}/big.ts", 1, size=4501 * 4)
    commit(repo, f"{TODO}/edge.ts", 1, size=4500 * 4)
    picked = pick(tmp_path, repo)
    assert picked["big_files"] == [f"{TODO}/big.ts"]
    assert f"{TODO}/big.ts" in picked["report"]


def test_pick_leaves_out_commits_of_prs_from_findings(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    commit(repo, f"{TODO}/a.ts", 1, "refactor(todo): merge the hooks (#50)")
    commit(repo, f"{TODO}/a.ts", 2, "fix(todo): follow-up (#50)")
    commit(repo, f"{TODO}/a.ts", 3, "feat(todo): new (#51)")
    commit(repo, f"{LOG}/b.ts", 1)
    commit(repo, f"{LOG}/b.ts", 2)
    issues = [
        issue(40, ["review:design", "refactor"], 20, f"Area: `{TODO}`", state="closed"),
        issue(45, ["refactor"], 15, "From #40: merge the hooks"),
    ]
    pulls = [
        {"number": 50, "body": "Closes #45", "merged_at": ago(1)},
        {"number": 51, "body": "Closes #9", "merged_at": ago(3)},
    ]
    picked = pick(tmp_path, repo, {"issues": issues, "pulls": pulls})
    assert counts(picked, TODO)["commits"] == 1
    assert picked["area"] == LOG


def reviewed_todo(days: float, bugs: list[float]) -> dict[str, Any]:
    review = issue(40, ["review:design", "refactor"], days, f"Area: `{TODO}`")
    found = [issue(60 + i, ["bug"], d, f"{TODO}/a.ts fails") for i, d in enumerate(bugs)]
    return {"issues": [review, *found], "pulls": []}


def busy_todo(tmp_path: Path) -> Path:
    repo = make_repo(tmp_path)
    for days in (1, 2, 3):
        commit(repo, f"{TODO}/a.ts", days)
    commit(repo, f"{LOG}/b.ts", 1)
    return repo


def test_pick_skips_area_reviewed_within_four_weeks(tmp_path: Path) -> None:
    picked = pick(tmp_path, busy_todo(tmp_path), reviewed_todo(10, [9, 2]))
    assert picked["area"] == LOG
    assert "reviewed" in picked["report"]


def test_pick_takes_back_reviewed_area_with_three_bugs_since(tmp_path: Path) -> None:
    picked = pick(tmp_path, busy_todo(tmp_path), reviewed_todo(10, [9, 2, 1, 11]))
    assert picked["area"] == TODO


def test_pick_takes_back_area_reviewed_over_four_weeks_ago(tmp_path: Path) -> None:
    picked = pick(tmp_path, busy_todo(tmp_path), reviewed_todo(29, []))
    assert picked["area"] == TODO


def test_pick_finds_no_area_in_a_quiet_week(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    commit(repo, f"{TODO}/a.ts", 8)
    commit(repo, "frontend/tests/a.test.ts", 1)
    commit(repo, "docs/how-to/a.md", 1)
    picked = pick(tmp_path, repo)
    assert picked["area"] is None
    assert picked["areas"] == [] or all(row["commits"] == 0 for row in picked["areas"])
    assert len(picked["report"].strip().splitlines()) == 1


def test_bug_naming_no_file_counts_toward_no_area(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    commit(repo, f"{TODO}/a.ts", 1)
    commit(repo, f"{LOG}/b.ts", 1)
    picked = pick(
        tmp_path, repo, {"issues": [issue(1, ["bug"], 1, "The page is slow")], "pulls": []}
    )
    assert all(row["bugs"] == 0 for row in picked["areas"])


def test_pick_splits_a_big_flat_folder_by_first_word(tmp_path: Path) -> None:
    repo = make_repo(tmp_path)
    names = (
        [f"todo-{i}.tsx" for i in range(10)]
        + [f"log-{i}.tsx" for i in range(10)]
        + ["use-todo-x.ts"]
    )
    for name in names:
        commit(repo, f"frontend/src/components/{name}", 1)
    picked = pick(tmp_path, repo)
    assert picked["area"] == "frontend/src/components:todo"
    assert counts(picked, "frontend/src/components:todo")["commits"] == 11


def test_context_lists_open_and_closed_review_issues(tmp_path: Path) -> None:
    issues = [
        issue(
            40,
            ["review:design"],
            20,
            "- [x] **Merge the hooks**\n- [ ] **Move x**",
            state="closed",
            title="old review",
        ),
        issue(41, ["review:design"], 5, "- [ ] **Fold y**", title="open review"),
        issue(42, ["bug"], 5, "not a review", title="a bug"),
    ]
    out = run(tmp_path, "context", data={"issues": issues, "pulls": []}).stdout
    assert "old review" in out and "closed" in out and "- [ ] **Move x**" in out
    assert "open review" in out and "- [ ] **Fold y**" in out
    assert "a bug" not in out


def file_issue(
    tmp_path: Path, findings: str | None, issues: list[dict[str, Any]] | None = None
) -> str:
    path = tmp_path / "findings.md"
    if findings is not None:
        path.write_text(findings)
    area = tmp_path / "area.json"
    area.write_text(
        json.dumps({"area": TODO, "reason": "commits=3 bugs=1", "areas": [], "big_files": []})
    )
    args = ("file", "--findings", str(path), "--area-json", str(area))
    return run(tmp_path, *args, data={"issues": issues or [], "pulls": []}).stdout


def finding(title: str) -> str:
    return f"- [ ] **{title}**\n  Files: `{TODO}/a.ts`. Change: merge. Shows: 4 files per task.\n"


def test_file_writes_the_findings_as_a_checklist_with_the_area(tmp_path: Path) -> None:
    body = file_issue(
        tmp_path, "Intro the agent wrote.\n\n" + finding("Merge a") + finding("Move b")
    )
    assert body.count("- [ ] ") == 2
    assert f"Area: `{TODO}`" in body
    assert "commits=3 bugs=1" in body
    assert "Intro the agent wrote" not in body


def test_file_cuts_more_than_five_findings_to_five(tmp_path: Path) -> None:
    body = file_issue(tmp_path, "".join(finding(f"Change {i}") for i in range(7)))
    assert body.count("- [ ] ") == 5
    assert "Change 4" in body and "Change 5" not in body


def test_file_drops_a_finding_already_on_a_review_issue(tmp_path: Path) -> None:
    past = [issue(40, ["review:design"], 20, "- [ ] **Merge the TODO hooks.**", state="closed")]
    body = file_issue(tmp_path, finding("merge the todo hooks") + finding("Move b"), past)
    assert body.count("- [ ] ") == 1
    assert "Move b" in body


def test_file_writes_nothing_without_a_checklist_item(tmp_path: Path) -> None:
    assert file_issue(tmp_path, "Nothing here is worth changing.\n") == ""
    assert file_issue(tmp_path, None) == ""
    past = [issue(40, ["review:design"], 20, "- [ ] **Move b**", state="closed")]
    assert file_issue(tmp_path, finding("Move b"), past) == ""


def test_prompt_asks_for_the_design_lens_and_evidence() -> None:
    text = PROMPT.read_text()
    for needle in (
        "docs/how-to/review-an-area-for-deep-modules.md",
        "REVIEW.md",
        ".review/findings.md",
    ):
        assert needle in text
    assert "{AREA}" in text and "at most 5" in text and "unticked" in text


def test_prompt_fills_the_area_its_files_and_the_big_files(tmp_path: Path) -> None:
    area = tmp_path / "area.json"
    picked = {"area": TODO, "reason": "3 commits", "files": [f"{TODO}/a.ts"], "big_files": ["x.ts"]}
    area.write_text(json.dumps(picked))
    out = run(tmp_path, "prompt", "--area-json", str(area)).stdout
    assert f"`{TODO}`" in out and "3 commits" in out
    assert f"- `{TODO}/a.ts`" in out and "- `x.ts`" in out
    assert not any(p in out for p in ("{AREA}", "{REASON}", "{FILES}", "{BIG}"))
