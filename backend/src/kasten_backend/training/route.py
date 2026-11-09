"""`GET /api/training`: the days of a range whose note holds a `## Training`, and its entries."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from kasten_backend import vault
from kasten_backend.config import Settings, get_settings
from kasten_backend.log import DATE_PATTERN
from kasten_backend.periodic import DAILY, daily_path, day_notes, heading_lines
from kasten_backend.training.lines import TrainingEntry, parse_line

router = APIRouter()

TRAINING = "## Training"


class TrainingDay(BaseModel):
    """A day whose note holds a `## Training`: the lines that parsed, in line order."""

    date: str
    path: str
    entries: list[TrainingEntry]


@router.get("/api/training")
def read_training(
    start: Annotated[str, Query(alias="from", pattern=DATE_PATTERN)],
    end: Annotated[str, Query(alias="to", pattern=DATE_PATTERN)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[TrainingDay]:
    """The days from `from` to `to`, both included, that have a `## Training` in their note.

    A line that does not parse is a plain bullet and absent. Nothing is written.
    """
    # A plain `def`, so FastAPI runs the file reads in its thread pool.
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="`from` and `to` must be real dates") from error
    if first > last:
        raise HTTPException(status_code=400, detail="`from` is after `to`")

    folder = vault.resolve_folder(settings.vault_path, f"{settings.periodic_path}/{DAILY}")
    if folder is None:
        return []
    days: list[TrainingDay] = []
    for day in day_notes(folder, first, last):
        path = daily_path(day, settings.periodic_path)
        try:
            text = vault.read_note(settings.vault_path, path)
        except UnicodeDecodeError, OSError:
            # A note the reader cannot take is skipped as a missing one, as `/api/log` does.
            continue
        lines = None if text is None else heading_lines(text, TRAINING)
        if lines is None:
            continue
        entries = [
            parsed for number, line in lines if (parsed := parse_line(line, number)) is not None
        ]
        days.append(TrainingDay(date=day.isoformat(), path=path, entries=entries))
    return days
