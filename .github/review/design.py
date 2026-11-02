"""The weekly design review: pick the area, give the agent past reviews, write the issue.

    python3 .github/review/design.py pick [--json area.json]
    python3 .github/review/design.py context > .review/past.md
    python3 .github/review/design.py prompt --area-json area.json
    python3 .github/review/design.py file --findings .review/findings.md --area-json area.json

Each reads issues and pull requests from --data, or fetches them from GitHub
(no token needed for this public repo; GITHUB_TOKEN raises the rate limit).
Stdlib only: the runner's python3 has no uv.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import NamedTuple

REPO = os.environ.get("GITHUB_REPOSITORY", "pgoell/kasten")
ROOTS = ("frontend/src/", "backend/src/", "jobs/src/", "shell/")
SOURCE = (".py", ".ts", ".tsx", ".js", ".mjs", ".sh")
GENERATED = ("routeTree.gen.ts", "api-types.ts")
CROWDED = 20
PAGE = 100
TRIES = 3
WEEK = timedelta(days=7)
REVIEW_GAP = timedelta(days=28)
BUGS_TO_RETURN = 3
BIG_TOKENS = 4500
MAX_FINDINGS = 5
NO_AREA = "No area to review: no commits or bugs in the last 7 days outside areas reviewed lately."
INTRO = """Weekly design review of `{area}`, by docs/how-to/review-an-area-for-deep-modules.md.

Area: `{area}`
Why this area: {reason}

Tick the findings to build. Make each ticked one its own `refactor` issue, without
`not-for-loop`, with `From #<this issue>` in its body, so the next run leaves out
the commits that build it. A finding left unticked when this issue closes counts as
rejected and is not filed again.

## Findings

"""

Bug = tuple[datetime, set[str]]


def when(stamp: str) -> datetime:
    """Parse a GitHub timestamp."""
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def read(request: urllib.request.Request) -> dict | list:
    """Fetch one page, waiting out the rate limit: search allows 10 calls a minute unsigned."""
    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(request) as reply:  # noqa: S310 (a fixed https URL)
                return json.load(reply)
        except urllib.error.HTTPError as err:
            attempt += 1
            if err.headers.get("X-RateLimit-Remaining") != "0" or attempt == TRIES:
                raise
            time.sleep(max(1, int(err.headers["X-RateLimit-Reset"]) - time.time() + 1))


def get(path: str) -> list[dict]:
    """Read every page of a REST list, or of a search's items."""
    rows: list[dict] = []
    headers = {"Accept": "application/vnd.github+json"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    sep = "&" if "?" in path else "?"
    for page in range(1, 11):
        url = f"https://api.github.com/{path}{sep}per_page={PAGE}&page={page}"
        batch = read(urllib.request.Request(url, headers=headers))
        batch = batch["items"] if isinstance(batch, dict) else batch
        rows += batch
        if len(batch) < PAGE:
            break
    return rows


def search(query: str) -> list[dict]:
    """Search this repo's issues and pull requests."""
    return get(f"search/issues?q={urllib.parse.quote(f'repo:{REPO} {query}')}")


def fetch(now: datetime) -> dict:
    """Collect the issues and merged pull requests the commands read."""
    labels = [lab["name"] for lab in get(f"repos/{REPO}/labels")]
    queries = [f"label:bug,regression created:>={now - REVIEW_GAP:%Y-%m-%d}", "label:refactor"]
    queries += [f'label:"{label}"' for label in labels if label.startswith("review:")]
    issues = {}
    for query in queries:
        for row in search(f"is:issue {query}"):
            labels_of = [lab["name"] for lab in row["labels"]]
            issues[row["number"]] = {**row, "labels": labels_of, "body": row["body"] or ""}
    pulls = search(f"is:pr is:merged merged:>={now - WEEK:%Y-%m-%d}")
    merged = [
        {
            "number": p["number"],
            "body": p["body"] or "",
            "merged_at": p["pull_request"]["merged_at"],
        }
        for p in pulls
    ]
    return {"issues": list(issues.values()), "pulls": merged}


def is_review(issue: dict) -> bool:
    """Tell whether this issue came from a review job."""
    return any(label.startswith("review:") for label in issue["labels"])


def git(repo: Path, *args: str) -> str:
    """Run git in the repo and return what it prints."""
    return subprocess.run(  # noqa: S603
        ["git", *args],  # noqa: S607
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    ).stdout


def source_files(repo: Path) -> list[str]:
    """List the tracked source files, leaving out tests and generated code."""
    files = git(repo, "ls-files").splitlines()
    return [
        f
        for f in files
        if f.startswith(ROOTS)
        and f.endswith(SOURCE)
        and "/tests/" not in f
        and not re.search(r"(\.test\.|/test_)", f)
        and not f.endswith(GENERATED)
    ]


def area_map(files: list[str]) -> dict[str, str]:
    """Map each file to its area: its folder, split by first word when crowded."""
    per_folder = Counter(f.rpartition("/")[0] for f in files)
    areas = {}
    for f in files:
        folder, _, name = f.rpartition("/")
        word = re.split(r"[-_.]", name.removeprefix("use-"))[0]
        areas[f] = f"{folder}:{word}" if per_folder[folder] > CROWDED else folder
    return areas


def finding_pulls(data: dict) -> set[int]:
    """Number the merged pull requests that built a review's findings."""
    reviews = {i["number"] for i in data["issues"] if is_review(i)}
    findings = {
        i["number"]
        for i in data["issues"]
        if "refactor" in i["labels"]
        and i["number"] not in reviews
        and reviews & mentions(i["body"])
    }
    return {p["number"] for p in data["pulls"] if findings & mentions(p["body"])}


def mentions(text: str) -> set[int]:
    """Collect the issue numbers a text names."""
    return {int(n) for n in re.findall(r"#(\d+)", text)}


def commit_counts(repo: Path, areas: dict[str, str], now: datetime, skip: set[int]) -> Counter:
    """Count each area's commits in the last week, leaving out those of skip."""
    log = git(
        repo,
        "log",
        f"--since={(now - WEEK).isoformat()}",
        f"--until={now.isoformat()}",
        "--format=%x00%s",
        "--name-only",
    )
    counts: Counter = Counter()
    for entry in log.split("\0")[1:]:
        subject, *names = entry.splitlines()
        pr = re.search(r"\(#(\d+)\)\s*$", subject)
        if pr and int(pr.group(1)) in skip:
            continue
        counts.update({areas[n] for n in names if n in areas})
    return counts


def bug_areas(data: dict, areas: dict[str, str]) -> list[Bug]:
    """Give each bug or regression issue's date and the areas whose files it names."""
    names = Counter(f.rpartition("/")[2] for f in areas)
    lookup = {f.rpartition("/")[2]: a for f, a in areas.items() if names[f.rpartition("/")[2]] == 1}
    lookup.update(areas)
    bugs = []
    for i in data["issues"]:
        if {"bug", "regression"} & set(i["labels"]):
            tokens = re.findall(r"[\w./-]+\.\w+", f"{i['title']} {i['body']}")
            hit = {a for t in tokens if (a := lookup.get(t) or lookup.get(t.rpartition("/")[2]))}
            bugs.append((when(i["created_at"]), hit))
    return bugs


def last_reviews(data: dict) -> dict[str, tuple[datetime, int]]:
    """Map each reviewed area to its latest review's date and number."""
    last: dict[str, tuple[datetime, int]] = {}
    for i in sorted(data["issues"], key=lambda i: i["created_at"]):
        found = re.search(r"^Area: `(.+?)`", i["body"], re.MULTILINE)
        if "review:design" in i["labels"] and found:
            last[found.group(1)] = (when(i["created_at"]), i["number"])
    return last


class Row(NamedTuple):
    """One area's counts."""

    area: str
    commits: int
    bugs: int
    big: int


def score(repo: Path, data: dict, now: datetime) -> tuple[list[Row], list[Bug], dict, list[str]]:
    """Count each active area's commits, bugs and big files, busiest first."""
    files = source_files(repo)
    areas = area_map(files)
    commits = commit_counts(repo, areas, now, finding_pulls(data))
    bugs = bug_areas(data, areas)
    big = [f for f in files if (repo / f).stat().st_size // 4 > BIG_TOKENS]
    rows = [
        Row(
            area,
            commits[area],
            sum(1 for at, hit in bugs if area in hit and at > now - WEEK),
            sum(areas[f] == area for f in big),
        )
        for area in set(commits) | {a for _, hit in bugs for a in hit}
    ]
    rows.sort(key=lambda r: (-(r.commits + r.bugs), -r.big, r.area))
    return rows, bugs, areas, big


def choose(
    rows: list[Row], bugs: list[Bug], data: dict, now: datetime
) -> tuple[Row | None, list[str]]:
    """Take the busiest area not reviewed lately, and note those skipped."""
    reviewed = last_reviews(data)
    skipped = []
    for row in rows:
        if row.commits + row.bugs == 0:
            break
        if row.area not in reviewed:
            return row, skipped
        at, number = reviewed[row.area]
        since = sum(1 for b, hit in bugs if row.area in hit and b > at)
        if now - at >= REVIEW_GAP or since >= BUGS_TO_RETURN:
            return row, skipped
        skipped.append(
            f"Skipped {row.area}: reviewed {at:%Y-%m-%d} in #{number}, {since} bugs since."
        )
    return None, skipped


def pick(repo: Path, data: dict, now: datetime) -> tuple[dict, list[str]]:
    """Choose the area to review and say why, in lines for a person."""
    rows, bugs, areas, big = score(repo, data, now)
    chosen, skipped = choose(rows, bugs, data, now)
    picked = {"area": None, "reason": "", "files": [], "areas": [r._asdict() for r in rows]}
    picked["big_files"] = big
    if not chosen:
        return picked, [NO_AREA]
    reason = f"{chosen.commits} commits and {chosen.bugs} bug issues in 7 days"
    reason += f", {chosen.big} files over {BIG_TOKENS} tokens"
    picked |= {"area": chosen.area, "reason": reason}
    picked["files"] = [f for f, a in areas.items() if a == chosen.area]
    report = [f"Picked {chosen.area}: {reason}.", *skipped, "", "Area commits bugs big"]
    report += [" ".join(map(str, r)) for r in rows[:10]]
    return picked, [*report, "", f"Files over {BIG_TOKENS} tokens:", *big]


def context(data: dict) -> str:
    """Write every review issue, open and closed, for the agent to read."""
    reviews = sorted((i for i in data["issues"] if is_review(i)), key=lambda i: i["number"])
    return "".join(
        f"## #{i['number']} {i['title']} ({i['state']})\n\n{i['body']}\n\n" for i in reviews
    )


def items(text: str) -> list[list[str]]:
    """Split the agent's text into checklist items, each with its indented lines."""
    found: list[list[str]] = []
    current: list[str] | None = None
    for line in text.splitlines():
        if line.startswith("- [ ] "):
            current = [line]
            found.append(current)
        elif current is not None and (not line.strip() or line[0].isspace()):
            current.append(line)
        else:
            current = None
    return found


def key(title: str) -> str:
    """Reduce a finding's title to words, for comparing."""
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", title.lower()).split())


def write_issue(findings: Path, picked: dict, data: dict) -> str:
    """Build the issue body from the new findings, or return nothing."""
    if not findings.exists():
        return ""
    past = {
        key(m)
        for i in data["issues"]
        if is_review(i)
        for m in re.findall(r"^- \[[ xX]\] (.+)$", i["body"], re.MULTILINE)
    }
    fresh = [lines for lines in items(findings.read_text()) if key(lines[0][6:]) not in past]
    if not fresh:
        return ""
    body = "\n".join("\n".join(lines).rstrip() for lines in fresh[:MAX_FINDINGS])
    return INTRO.format(area=picked["area"], reason=picked["reason"]) + body + "\n"


def prompt(picked: dict) -> str:
    """Fill the agent's prompt with the picked area, its files and the big files."""
    listed = {k: "\n".join(f"- `{f}`" for f in picked[k]) for k in ("files", "big_files")}
    text = (Path(__file__).parent / "design.md").read_text()
    text = text.replace("{AREA}", picked["area"]).replace("{REASON}", picked["reason"])
    return text.replace("{FILES}", listed["files"]).replace("{BIG}", listed["big_files"])


def main() -> None:
    """Run the command the arguments name."""
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["pick", "context", "file", "prompt", "fetch"])
    parser.add_argument("--data", type=Path)
    parser.add_argument("--now", default=datetime.now(UTC).isoformat())
    parser.add_argument("--repo", type=Path, default=Path())
    parser.add_argument("--json", type=Path)
    parser.add_argument("--findings", type=Path)
    parser.add_argument("--area-json", type=Path)
    args = parser.parse_args()
    now = when(args.now)
    if args.command == "prompt":
        sys.stdout.write(prompt(json.loads(args.area_json.read_text())))
        return
    data = json.loads(args.data.read_text()) if args.data else fetch(now)
    if args.command == "fetch":
        print(json.dumps(data))
    elif args.command == "pick":
        picked, report = pick(args.repo, data, now)
        if args.json:
            args.json.write_text(json.dumps(picked, indent=1))
        print("\n".join(report))
    elif args.command == "context":
        sys.stdout.write(context(data))
    else:
        sys.stdout.write(write_issue(args.findings, json.loads(args.area_json.read_text()), data))


if __name__ == "__main__":
    main()
