"""`GET /api/training`: the days of a range whose note holds a `## Training`, and its entries."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings
from kasten_backend.log import DATE_PATTERN, date_range
from kasten_backend.periodic import day_sections
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
