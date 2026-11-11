"""The command: read the last days' activities, and write each new walk, run or ride once.

The ids written are kept in a state file on the server, so a line deleted by hand stays gone.
An activity a hand-typed line already holds, the same kind within a few minutes, is left out;
the lines this job wrote itself, which the state also keeps, never count as typed.
"""

import argparse
import json
import logging
import os
from collections import defaultdict
from dataclasses import dataclass, field
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


@dataclass
class State:
    """The ids looked at, and the day, kind and minutes of each line written or standing in."""

    written: list[int] = field(default_factory=list)
    own: list[list[Any]] = field(default_factory=list)

    def wrote(self, activity: Activity) -> None:
        """Count `activity` as written: its id, and what its line says."""
        self.written.append(activity.id)
        self.own.append([activity.day, activity.kind, minutes_of(activity)])


def read_state(path: Path) -> State:
    """What earlier runs kept, nothing before the first run."""
    if not path.exists():
        return State()
    kept = json.loads(path.read_text(encoding="utf-8"))
    return State([int(i) for i in kept.get("written", [])], list(kept.get("own", [])))


def write_state(path: Path, state: State) -> None:
    """Keep the newest, through a temp file so a crash leaves the old state whole."""
    path.parent.mkdir(parents=True, exist_ok=True)
    held = path.with_suffix(".tmp")
    kept = {"written": state.written[-KEPT_IDS:], "own": state.own[-KEPT_IDS:]}
    held.write_text(json.dumps(kept), encoding="utf-8")
    held.replace(path)


def minutes_of(activity: Activity) -> int:
    """The minutes as its line writes them."""
    return max(1, round(activity.minutes))


def hand_typed(
    entries: list[dict[str, Any]], day: str, own: list[list[Any]]
) -> list[dict[str, Any]]:
    """The day's entries less one for each line this job wrote there."""
    left = list(entries)
    for wrote_day, kind, minutes in own:
        if wrote_day != day:
            continue
        match = next(
            (e for e in left if e.get("kind") == kind and e.get("minutes") == minutes), None
        )
        if match is not None:
            left.remove(match)
    return left


def typed(activity: Activity, entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The typed entry of the same kind and about the same minutes, if the day holds one."""
    for entry in entries:
        minutes = entry.get("minutes")
        if entry.get("kind") != activity.kind or not isinstance(minutes, int | float):
            continue
        if abs(minutes - activity.minutes) <= max(2, activity.minutes * CLOSE):
            return entry
    return None


def run(
    garmin: GarminApi, kasten: KastenApi, settings: Settings, today: date, *, dry_run: bool = False
) -> int:
    """One pass over the look-back. Answers the exit code: 0, also when nothing was new."""
    start = (today - timedelta(days=settings.days)).isoformat()
    state = read_state(settings.state)
    rows = garmin.activities(start, today.isoformat())
    fresh = [a for row in rows if (a := activity_of(row)) is not None and a.id not in state.written]
    days = {
        day["date"]: hand_typed(day["entries"], day["date"], state.own)
        for day in kasten.training(start, today.isoformat())
    }
    by_day: dict[str, list[Activity]] = defaultdict(list)
    for activity in fresh:
        entries = days.get(activity.day, [])
        match = typed(activity, entries)
        if match is None:
            by_day[activity.day].append(activity)
            continue
        # One typed line stands for one activity, this run and later ones, so a second ride of
        # the day still gets written. Its own minutes, as `hand_typed` matches them exactly.
        entries.remove(match)
        log.info("%s %s is typed by hand already; left out", activity.day, activity.kind)
        state.written.append(activity.id)
        state.own.append([activity.day, activity.kind, match["minutes"]])
    for day, activities in sorted(by_day.items()):
        lines = [line_of(a, settings.notes) for a in activities]
        if dry_run:
            print("\n".join(f"{day} {line}" for line in lines))
            continue
        added = kasten.post_training_lines(day, lines)
        log.info("%s: %d written", day, len(added))
        for activity in activities:
            state.wrote(activity)
        write_state(settings.state, state)
    if not dry_run:
        write_state(settings.state, state)
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
