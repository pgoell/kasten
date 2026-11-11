"""`GET /api/training`: the days of a range whose note holds a `## Training`, and its entries."""

import asyncio
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from kasten_backend.config import Settings, get_settings
from kasten_backend.periodic import DATE_PATTERN, daily_path, date_range, day_sections
from kasten_backend.training.blocks import TrainingBlock, blocks
from kasten_backend.training.days import TRAINING, add_lines
from kasten_backend.training.exercises import Exercise, exercises
from kasten_backend.training.lines import TrainingEntry, parse_line

router = APIRouter()


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
    first, last = date_range(start, end)
    return [
        TrainingDay(
            date=day.isoformat(),
            path=path,
            entries=[
                parsed for number, line in lines if (parsed := parse_line(line, number)) is not None
            ],
        )
        for day, path, lines in day_sections(
            settings.vault_path, settings.periodic_path, first, last, TRAINING
        )
    ]


@router.get("/api/training/exercises")
async def read_exercises(settings: Annotated[Settings, Depends(get_settings)]) -> list[Exercise]:
    """Every exercise note outside the archive, by name: a note whose `kind` names an exercise."""
    return await asyncio.to_thread(exercises, settings.vault_path, settings.archive_path)


@router.get("/api/training/blocks")
async def read_blocks(settings: Annotated[Settings, Depends(get_settings)]) -> list[TrainingBlock]:
    """Every training block note outside the archive, by start: a note whose `type` says so."""
    return await asyncio.to_thread(blocks, settings.vault_path, settings.archive_path)


class NewLines(BaseModel):
    """Training lines for one day, each one line as the training format writes it."""

    lines: list[str] = Field(min_length=1, max_length=50)


class AddedLines(BaseModel):
    """The day's note, and the lines that were not in it yet."""

    path: str
    added: list[str]


@router.post("/api/training/days/{day}")
async def post_training_lines(
    day: Annotated[str, Path(pattern=DATE_PATTERN)],
    body: NewLines,
    settings: Annotated[Settings, Depends(get_settings)],
) -> AddedLines:
    """Add lines under the day's `## Training`, each one, a copy of a line there too.

    Every line must read as a training line, or nothing is written and the answer is `422`.
    """
    try:
        when = date.fromisoformat(day)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Not a day") from error
    lines = [line.rstrip() for line in body.lines]
    if any("\n" in line or "\r" in line or parse_line(line, 0) is None for line in lines):
        raise HTTPException(status_code=422, detail="Not a training line")
    added = await add_lines(settings, when, lines)
    return AddedLines(path=daily_path(when, settings.periodic_path), added=added)
