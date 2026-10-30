"""The GitHub contributions the review draws, read once a day and kept outside the vault.

GitHub answers how many contributions a user made each day. A settled day, one read on a later
day, is kept for good; others are read again after an hour. The token goes to GitHub in the
`Authorization` header and nowhere else.
"""

import asyncio
import logging
import os
import tempfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
from pydantic import BaseModel, Field, ValidationError

GRAPHQL_URL = "https://api.github.com/graphql"

QUERY = (
    "query($login: String!, $from: DateTime!, $to: DateTime!) {"
    " user(login: $login) { contributionsCollection(from: $from, to: $to) {"
    " contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }"
)
"""One user's contributions over a range, a day at a time, as GitHub's GraphQL spells it."""

USER_AGENT = "kasten-backend"
"""What GitHub asks every client to name itself with."""

MOST_DAYS = 366
"""The longest range one read asks for, the most a contributions collection holds."""

REREAD_SECONDS = 60 * 60
"""How long a read is kept before GitHub is asked again for the days of the range.

Long enough that a page opened twice does not ask twice, short enough that today's count is
not stale.
"""

TIMEOUT_SECONDS = 10.0

logger = logging.getLogger(__name__)


class GitHubUnavailableError(Exception):
    """GitHub could not be read, and none of the range is cached to answer with."""


class _BadAnswerError(Exception):
    """GitHub answered, but not with a calendar: an error, or a shape the query did not ask for."""


class Cache(BaseModel):
    """The cache file: whose days these are, their counts, which are settled, and the last read."""

    user: str
    days: dict[str, int]
    settled: set[str] = Field(default_factory=set)
    """The days read on a later day than themselves: GitHub's count for them is final."""
    read: datetime


_lock = asyncio.Lock()
"""Held across the load, the ask and the save, so two reads cannot drop each other's days.

One backend process, one lock.
"""


def _client() -> httpx.AsyncClient:
    """The client GitHub is asked with, a seam the tests answer through."""
    return httpx.AsyncClient(timeout=TIMEOUT_SECONDS)


def _now() -> datetime:
    """The moment now, a seam so a test can move the clock on without waiting for it."""
    return datetime.now(UTC)


def _today() -> date:
    """Today in UTC, the day `_ask` bounds its days by.

    A day counts as settled only once it has ended in UTC, GitHub's calendar zone. The server's own
    zone would end a day hours early, and a short count would then be kept for good.
    """
    return _now().date()


def _days(first: date, last: date) -> list[str]:
    """Every day from `first` to `last`, both ends in, as `YYYY-MM-DD`."""
    return [(first + timedelta(days=n)).isoformat() for n in range((last - first).days + 1)]


def _load(path: Path, user: str) -> Cache | None:
    """The cache the file holds for `user`, or None when there is none or it is another user's."""
    if not path.is_file():
        return None
    try:
        cache = Cache.model_validate_json(path.read_text(encoding="utf-8"))
    except OSError, ValueError:
        # A file that cannot be read is no cache, and the next read writes over it.
        return None
    return cache if cache.user == user else None


def _save(path: Path, cache: Cache) -> None:
    """Replace the cache file with `cache`, atomically, the way the tokens file is written.

    A temp file beside it, then `replace`, so a reader sees the old file or the new, never half.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=".github", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as output:
            output.write(cache.model_dump_json())
        Path(temporary).replace(path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


class _Day(BaseModel):
    """One day of GitHub's calendar: its date and its contribution count."""

    day: str = Field(alias="date")
    count: int = Field(alias="contributionCount")


class _Week(BaseModel):
    days: list[_Day] = Field(alias="contributionDays")


class _Calendar(BaseModel):
    weeks: list[_Week]


class _Collection(BaseModel):
    calendar: _Calendar = Field(alias="contributionCalendar")


class _User(BaseModel):
    collection: _Collection = Field(alias="contributionsCollection")


class _Data(BaseModel):
    user: _User | None


class _Answer(BaseModel):
    """The shape of GitHub's answer to the query, read whole so an unexpected one is refused."""

    data: _Data
    errors: list[object] | None = None


def _counts(body: object, first: date, last: date) -> dict[str, int]:
    """The count of each day from `first` to `last` in GitHub's answer.

    A login it does not know, or a refused token, comes back as a 200 with `errors` and no user.
    """
    try:
        answer = _Answer.model_validate(body)
    except ValidationError as error:
        raise _BadAnswerError("GitHub's answer holds no calendar") from error
    if answer.errors is not None or answer.data.user is None:
        raise _BadAnswerError("GitHub answered with errors")
    counts = {
        day.day: day.count
        for week in answer.data.user.collection.calendar.weeks
        for day in week.days
    }
    # GitHub answers whole weeks, so the days either side of the range come back too.
    wanted = set(_days(first, last))
    return {day: count for day, count in counts.items() if day in wanted}


async def _ask(user: str, token: str, first: date, last: date) -> dict[str, int]:
    """One read of GitHub for the days from `first` to `last`. Raises when it cannot be read."""
    body = {
        "query": QUERY,
        "variables": {
            "login": user,
            "from": f"{first.isoformat()}T00:00:00Z",
            "to": f"{last.isoformat()}T23:59:59Z",
        },
    }
    headers = {"Authorization": f"bearer {token}", "User-Agent": USER_AGENT}
    async with _client() as client:
        response = await client.post(GRAPHQL_URL, json=body, headers=headers)
        response.raise_for_status()
    try:
        answer = response.json()
    except ValueError as error:
        raise _BadAnswerError("GitHub's answer is not JSON") from error
    return _counts(answer, first, last)


async def contributions(
    user: str, token: str, cache: Path, first: date, last: date
) -> dict[str, int]:
    """The contributions `user` made on each day from `first` to `last`, keyed by `YYYY-MM-DD`.

    The cache answers when every day up to today is held, settled or read under an hour ago.
    Otherwise GitHub is asked once and the answer merged in. A failed read answers from the
    cache, and with none held raises `GitHubUnavailableError`.
    """
    async with _lock:
        return await _contributions(user, token, cache, first, last)


async def _contributions(
    user: str, token: str, cache: Path, first: date, last: date
) -> dict[str, int]:
    """`contributions`, with the lock held by the caller."""
    wanted = _days(first, last)
    today = _today().isoformat()
    held = _load(cache, user)
    days = held.days if held is not None else {}
    settled = held.settled if held is not None else set()
    recent = held is not None and _now() - held.read < timedelta(seconds=REREAD_SECONDS)
    due = [day for day in wanted if day <= today]
    if all(day in days and (day in settled or recent) for day in due):
        return {day: days[day] for day in wanted if day in days}

    try:
        asked = await _ask(user, token, first, last)
    except (httpx.HTTPError, _BadAnswerError) as error:
        known = {day: days[day] for day in wanted if day in days}
        if not known:
            raise GitHubUnavailableError from error
        logger.warning(
            "GitHub could not be read, answering %d cached days: %s",
            len(known),
            type(error).__name__,
        )
        return known

    # A day read on a later day than itself is settled: the count it got then is final.
    settled = settled | {day for day in asked if day < today}
    try:
        _save(
            cache,
            Cache(user=user, days={**days, **asked}, settled=settled, read=_now()),
        )
    except OSError as error:
        # The answer is good whether or not it is kept, so a cache that cannot be
        # written costs only the next read.
        logger.warning("The GitHub cache could not be written: %s", type(error).__name__)
    return asked
