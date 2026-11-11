"""A Garmin activity as a training line: `- 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131`.

docs/reference/training/training-format.md gives the line; only walks, runs and rides make one.
"""

from dataclasses import dataclass
from typing import Any

MARKS = {"walk": "🚶", "run": "🏃", "ride": "🚲"}
NOTES = {"walk": "Gehen", "run": "Joggen", "ride": "Radfahren"}
DAY = len("2026-11-11")
LEAST_METRES = 50
"""Under this a distance would round to `0 km`, so the line leaves it out."""
# Garmin's type keys by the word each holds: `trail_running`, `road_biking`, `hiking`.
WORDS = (("run", "run"), ("cycl", "ride"), ("bik", "ride"), ("walk", "walk"), ("hik", "walk"))


@dataclass(frozen=True)
class Activity:
    """What a line needs of one activity."""

    id: int
    day: str
    kind: str
    minutes: float
    km: float | None
    heart_rate: int | None


def kind_of(type_key: str) -> str | None:
    """`walk`, `run` or `ride` for a Garmin type key, or None for any other sport."""
    key = type_key.lower()
    if "motor" in key:
        return None
    return next((kind for word, kind in WORDS if word in key), None)


def activity_of(row: dict[str, Any]) -> Activity | None:
    """The activity a row of the list holds, or None for a sport or a row a line cannot carry."""
    kind = kind_of(str((row.get("activityType") or {}).get("typeKey") or ""))
    start = str(row.get("startTimeLocal") or "")
    seconds = row.get("duration") or row.get("movingDuration")
    if kind is None or len(start) < DAY or not isinstance(seconds, int | float) or seconds <= 0:
        return None
    metres = row.get("distance")
    heart = row.get("averageHR")
    return Activity(
        id=int(row["activityId"]),
        day=start[:DAY],
        kind=kind,
        minutes=seconds / 60,
        km=metres / 1000 if isinstance(metres, int | float) and metres >= LEAST_METRES else None,
        heart_rate=round(heart) if isinstance(heart, int | float) and heart > 0 else None,
    )


def written(value: float) -> str:
    """A number as a line writes it: a point and no trailing zeros, `7.4`, `5`."""
    return f"{value:.1f}".rstrip("0").rstrip(".")


def line_of(activity: Activity, notes: dict[str, str] = NOTES) -> str:
    """The training line for an activity, its minutes whole and at least one."""
    parts = [
        f"- {MARKS[activity.kind]} [[{notes[activity.kind]}]] {max(1, round(activity.minutes))} min"
    ]
    if activity.km is not None:
        parts.append(f"{written(activity.km)} km")
    if activity.heart_rate is not None:
        parts.append(f"❤ {activity.heart_rate}")
    return " ".join(parts)
