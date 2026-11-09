"""One `## Training` line read into its fields, or None for a line that is no entry.

`frontend/src/lib/log/cases/training-cases.json` holds this and `training-lines.ts` to the same
answers.
"""

import math
import re
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

_VS = "\N{VARIATION SELECTOR-16}?"
_NUMBER = r"[0-9]{1,9}(?:[.,][0-9]{1,9})?"
_RPE = r"[0-9]{1,2}(?:[.,][0-9])?"
_UNIT = r"cm|°|punkte|punkt|points?"
_VALUE = rf"-?{_NUMBER}[ \t]*(?:{_UNIT})|(?:nicht[ \t]+)?ok"
# A word that is not a side or a result, so `L 11 cm` and `nicht ok` never read as a label.
_LABEL = r"(?!(?:L|R|ok|nicht)(?![^ \t]))[^ \t,0-9-][^ \t,]*"

HEAD = re.compile(rf"- (🏋|🚶|🏃|🚲|📏){_VS}[ \t]+\[\[([^\[\]|]*)(?:\|[^\[\]]*)?\]\](.*)")
WEIGHTED = re.compile(
    rf"[ \t]+(?:({_NUMBER})[ \t]*kg|(bw))((?:[ \t]+[0-9]{{1,3}})+)(?:[ \t]+@({_RPE}))?[ \t]*",
    re.IGNORECASE,
)
TIMED = re.compile(
    rf"[ \t]+([0-9]{{1,3}})[ \t]*x[ \t]*({_NUMBER})[ \t]*(s|min)[ \t]*", re.IGNORECASE
)
CARDIO = re.compile(
    rf"[ \t]+({_NUMBER})[ \t]*min(?:[ \t]+({_NUMBER})[ \t]*km)?"
    rf"(?:[ \t]+❤{_VS}[ \t]*([0-9]{{1,3}}))?[ \t]*",
    re.IGNORECASE,
)
GROUP = re.compile(
    rf"(?:({_LABEL})[ \t]+)?(?:L[ \t]+({_VALUE})[ \t]+R[ \t]+({_VALUE})|({_VALUE}))", re.IGNORECASE
)
VALUE = re.compile(rf"(-?{_NUMBER})[ \t]*({_UNIT})|(nicht[ \t]+)?ok", re.IGNORECASE)
GROUP_SPLIT = re.compile(r",[ \t]+")

MAX_RPE = 10

CARDIO_KINDS = {"🚶": "walk", "🏃": "run", "🚲": "ride"}

MAX_E1RM_REPS = 10
"""Epley drifts past ten reps, so a longer set gives no estimate."""


class TrainingReading(BaseModel):
    """One value of a test: a number and its unit, or passed or not."""

    amount: float | None = None
    unit: str | None = None
    passed: bool | None = None


class TrainingGroup(BaseModel):
    """A test's values under one optional label: one per side, or one for both."""

    label: str | None = None
    left: TrainingReading | None = None
    right: TrainingReading | None = None
    value: TrainingReading | None = None


class TrainingEntry(BaseModel):
    """One training line that parsed: its kind, the exercise it links and the fields it gives."""

    line: int
    """Which line of the note it is, counting from one."""

    text: str
    kind: Literal["strength", "walk", "run", "ride", "test"]
    exercise: str
    """The link's target, the exercise note's name."""

    kg: float | None = None
    bodyweight: bool | None = None
    reps: list[int] | None = None
    sets: int | None = None
    seconds: float | None = None
    """How long each set of a timed exercise lasts."""

    rpe: float | None = None
    e1rm: float | None = None
    """The best Epley estimate over the sets of ten reps or fewer, in kg."""

    minutes: float | None = None
    km: float | None = None
    heart_rate: int | None = None
    groups: list[TrainingGroup] | None = None


def _number(text: str) -> float:
    """A written number, a comma read as the point."""
    return float(Decimal(text.replace(",", ".")))


def _tenth(value: float) -> float:
    """Rounded to a tenth, half up, as `Math.round` does in the browser's copy."""
    return math.floor(value * 10 + 0.5) / 10


def e1rm(kg: float, reps: list[int]) -> float | None:
    """The best estimated one-rep max over `reps` at `kg`, or None with no set short enough."""
    estimates = [kg * (30 + count) / 30 for count in reps if count <= MAX_E1RM_REPS]
    return _tenth(max(estimates)) if estimates else None


def _strength(rest: str) -> dict[str, object] | None:
    if found := WEIGHTED.fullmatch(rest):
        reps = [int(count) for count in found[3].split()]
        kg = _number(found[1]) if found[1] else None
        rpe = _number(found[4]) if found[4] else None
        if (
            min(reps) < 1
            or (kg is not None and kg <= 0)
            or (rpe is not None and not 1 <= rpe <= MAX_RPE)
        ):
            return None
        return {
            "kg": kg,
            "bodyweight": True if found[2] else None,
            "reps": reps,
            "sets": len(reps),
            "rpe": rpe,
            "e1rm": e1rm(kg, reps) if kg is not None else None,
        }
    if found := TIMED.fullmatch(rest):
        sets = int(found[1])
        seconds = _number(found[2]) * (60 if found[3].lower() == "min" else 1)
        return {"sets": sets, "seconds": seconds} if sets > 0 and seconds > 0 else None
    return None


def _cardio(rest: str) -> dict[str, object] | None:
    found = CARDIO.fullmatch(rest)
    if found is None:
        return None
    minutes = _number(found[1])
    km = _number(found[2]) if found[2] else None
    heart = int(found[3]) if found[3] else None
    if minutes <= 0 or (km is not None and km <= 0) or heart == 0:
        return None
    return {"minutes": minutes, "km": km, "heart_rate": heart}


def _reading(text: str | None) -> TrainingReading | None:
    if text is None:
        return None
    found = VALUE.fullmatch(text)
    if found is None:
        return None
    if found[1]:
        return TrainingReading(amount=_number(found[1]), unit=found[2])
    return TrainingReading(passed=found[3] is None)


def _test(rest: str) -> dict[str, object] | None:
    if not rest[:1].isspace():
        return None
    groups: list[TrainingGroup] = []
    for part in GROUP_SPLIT.split(rest.strip(" \t")):
        found = GROUP.fullmatch(part)
        if found is None:
            return None
        groups.append(
            TrainingGroup(
                label=found[1],
                left=_reading(found[2]),
                right=_reading(found[3]),
                value=_reading(found[4]),
            )
        )
    return {"groups": groups}


def parse_line(text: str, line: int) -> TrainingEntry | None:
    """The entry the line `line` of a note holds, or None for a line that is a plain bullet."""
    head = HEAD.fullmatch(text)
    if head is None or not head[2].strip():
        return None
    mark, rest = head[1], head[3]
    if mark == "🏋":
        kind, fields = "strength", _strength(rest)
    elif mark == "📏":
        kind, fields = "test", _test(rest)
    else:
        kind, fields = CARDIO_KINDS[mark], _cardio(rest)
    if fields is None:
        return None
    return TrainingEntry.model_validate(
        {"line": line, "text": text, "kind": kind, "exercise": head[2].strip(), **fields}
    )
