"""The command: read the last days' activities, and write each new walk, run or ride once.

The ids written are kept in a state file on the server, so a line deleted by hand stays gone.
An activity a hand-typed line already holds, the same kind within a few minutes, is left out.
"""

import argparse
import json
import logging
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx

from kasten_jobs.garmin.garmin_api import BASE, GarminApi
from kasten_jobs.garmin.lines import NOTES, Activity, activity_of, line_of
from kasten_jobs.kasten_api import KastenApi

if TYPE_CHECKING:
    from collections.abc import Mapping

log = logging.getLogger("kasten_jobs.garmin")

KEPT_IDS = 1000
"""How many written ids the state keeps; far more than the look-back ever reads."""
CLOSE = 0.15
"""How near a typed line's minutes must come to count as the same activity."""


@dataclass(frozen=True)
class Settings:
    """What the environment sets; docs/reference/garmin-sync.md lists each."""

    api: str
    key: str
    state: Path
    days: int
    notes: dict[str, str]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        """Read the settings, each but the key with its default."""
        return cls(
            api=env.get("KASTEN_API", "http://kasten-backend-prod:8000"),
            key=env.get("GARMIN_API_KEY", ""),
            state=Path(env.get("GARMIN_STATE", "/state/garmin-sync.json")),
            days=int(env.get("GARMIN_DAYS", "2")),
            notes={
                "walk": env.get("GARMIN_WALK_NOTE", NOTES["walk"]),
                "run": env.get("GARMIN_RUN_NOTE", NOTES["run"]),
                "ride": env.get("GARMIN_RIDE_NOTE", NOTES["ride"]),
            },
        )


def read_state(path: Path) -> list[int]:
    """The ids written so far, none before the first run."""
    if not path.exists():
        return []
    return [int(i) for i in json.loads(path.read_text(encoding="utf-8")).get("written", [])]


def write_state(path: Path, written: list[int]) -> None:
    """Keep the newest ids, through a temp file so a crash leaves the old state whole."""
    path.parent.mkdir(parents=True, exist_ok=True)
    held = path.with_suffix(".tmp")
    held.write_text(json.dumps({"written": written[-KEPT_IDS:]}), encoding="utf-8")
    held.replace(path)


def typed(activity: Activity, entries: list[dict[str, Any]]) -> bool:
    """Whether the day already holds a line of the same kind and about the same minutes."""
    for entry in entries:
        minutes = entry.get("minutes")
        if entry.get("kind") != activity.kind or not isinstance(minutes, int | float):
            continue
        if abs(minutes - activity.minutes) <= max(2, activity.minutes * CLOSE):
            return True
    return False


def run(
    garmin: GarminApi, kasten: KastenApi, settings: Settings, today: date, *, dry_run: bool = False
) -> int:
    """One pass over the look-back. Answers the exit code: 0, also when nothing was new."""
    start = (today - timedelta(days=settings.days)).isoformat()
    written = read_state(settings.state)
    rows = garmin.activities(start, today.isoformat())
    fresh = [a for row in rows if (a := activity_of(row)) is not None and a.id not in written]
    days = {day["date"]: day["entries"] for day in kasten.training(start, today.isoformat())}
    by_day: dict[str, list[Activity]] = defaultdict(list)
    for activity in fresh:
        if typed(activity, days.get(activity.day, [])):
            log.info("%s %s is typed by hand already; left out", activity.day, activity.kind)
            written.append(activity.id)
        else:
            by_day[activity.day].append(activity)
    for day, activities in sorted(by_day.items()):
        lines = [line_of(a, settings.notes) for a in activities]
        if dry_run:
            print("\n".join(f"{day} {line}" for line in lines))
            continue
        added = kasten.post_training_lines(day, lines)
        log.info("%s: %d new of %d", day, len(added), len(lines))
        written.extend(a.id for a in activities)
    if not dry_run:
        write_state(settings.state, written)
    return 0


def main(argv: list[str] | None = None) -> int:
    """`kasten-garmin-sync [--dry-run]`."""
    parser = argparse.ArgumentParser(prog="kasten-garmin-sync", description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print the lines, write nothing")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = Settings.from_env(os.environ)
    if settings.key == "":
        log.error("GARMIN_API_KEY is not set")
        return 2
    with (
        httpx.Client(base_url=BASE, timeout=30) as web,
        httpx.Client(base_url=settings.api, timeout=30) as local,
    ):
        return run(
            GarminApi(web, settings.key),
            KastenApi(local),
            settings,
            date.today(),
            dry_run=args.dry_run,
        )
