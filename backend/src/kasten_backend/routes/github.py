"""The GitHub contributions the year and week review draws, for the days a range names."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from kasten_backend import github
from kasten_backend.config import Settings, get_settings
from kasten_backend.log import DATE_PATTERN
from kasten_backend.routes.queries import day_range

router = APIRouter()


class Contributions(BaseModel):
    """Whether the review's GitHub section is on, and each day's count when it is."""

    on: bool
    """False without both a token and a user name, and then `days` is empty."""

    days: dict[str, int]
    """The contributions made each day of the range, keyed by `YYYY-MM-DD`."""


@router.get("/api/github")
async def read_github(
    start: Annotated[str, Query(alias="from", pattern=DATE_PATTERN)],
    end: Annotated[str, Query(alias="to", pattern=DATE_PATTERN)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Contributions:
    """The contributions the configured GitHub user made each day from `from` to `to`.

    Off, with GitHub never asked, unless both `KASTEN_GITHUB_TOKEN` and
    `KASTEN_GITHUB_USER` are set. The token and the user name are never in the
    answer. A day already read is answered from the cache file, as
    [the reference](/reference/http-api/capture.md#get-apigithub) says.
    """
    first, last = day_range(start, end)
    # Both ends in, so a range of 366 days is the most one read asks GitHub for.
    if (last - first).days >= github.MOST_DAYS:
        raise HTTPException(status_code=400, detail="A range is at most 366 days")

    token = settings.github_token.get_secret_value() if settings.github_token else ""
    if not (settings.github_user and token):
        return Contributions(on=False, days={})

    try:
        days = await github.contributions(
            settings.github_user, token, settings.github_cache, first, last
        )
    except github.GitHubUnavailableError as error:
        raise HTTPException(status_code=502, detail="GitHub could not be read") from error
    return Contributions(on=True, days=days)
