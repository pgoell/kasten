"""The collector's usage lines for the year review, read from its notes at `GET /api/model-use`."""

import asyncio
from dataclasses import asdict
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings
from kasten_backend.log import DATE_PATTERN
from kasten_backend.model_use_notes import months, note_path, read_month
from kasten_backend.routes.queries import day_range

if TYPE_CHECKING:
    from datetime import date
    from pathlib import Path

router = APIRouter()


class ModelUseLine(BaseModel):
    """One day, model and project of Claude Code's usage, and what it cost at list prices."""

    day: str
    model: str
    project: str
    input: int
    output: int
    cache_write: int
    cache_read: int
    cost: float | None
    """US dollars, None when no message of the group had a price."""

    unpriced: int
    """The tokens of the group that had no price, so the cost leaves them out."""


def _read(vault: Path, config_path: str, first: date, last: date) -> list[ModelUseLine]:
    """Every usage line of the months `first` to `last` touch, within those days."""
    found = []
    for month in months(first, last):
        found += read_month(
            note_path(vault, config_path, month), first.isoformat(), last.isoformat()
        )
    return [
        ModelUseLine(**asdict(usage))
        for usage in sorted(found, key=lambda usage: (usage.day, usage.model, usage.project))
    ]


@router.get("/api/model-use")
async def read_model_use(
    start: Annotated[str, Query(alias="from", pattern=DATE_PATTERN)],
    end: Annotated[str, Query(alias="to", pattern=DATE_PATTERN)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[ModelUseLine]:
    """The usage lines from `from` to `to`, sorted by day, model and project.

    Read from the collector's own notes under the config folder. A note without
    its marker and a line that does not parse are skipped, not answered.
    """
    first, last = day_range(start, end)
    return await asyncio.to_thread(_read, settings.vault_path, settings.config_path, first, last)
