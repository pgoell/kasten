"""The sender: every timer and todo reminder due in its late hour goes to every device, once.

One worker sends, the one holding the advisory lock. A reminder is recorded as sent in the
same transaction as its send, so a restart neither repeats one nor drops it.
"""

import asyncio
import datetime as dt
import hashlib
import itertools
import logging
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from kasten_backend.periodic import daily_path
from kasten_backend.push import webpush
from kasten_backend.push.due import LATE, Quiet, reminders, sendable, today_todos
from kasten_backend.push.models import PushDevice, PushSent, PushSettings, PushTimer
from kasten_backend.todos import find_todos

if TYPE_CHECKING:
    from kasten_backend.config import Settings
    from kasten_backend.search import Hit

logger = logging.getLogger(__name__)

PUSH_LOCK = 0x6B70_7573
"""The advisory lock one sender holds for a tick, `kpus` in ASCII, apart from the finance locks."""
GONE = {404, 410}
REFUSED = 300
EVERY_SECONDS = 15
"""A timer rings this close to its time."""
TODOS_EVERY = 4
"""Ticks between scans of the vault for todo reminders, which have a minute's grain anyway."""


async def tick(
    engine: AsyncEngine,
    settings: Settings,
    client: httpx.AsyncClient,
    now: dt.datetime,
    *,
    todos: bool = True,
) -> int:
    """Send what is due at `now` if this worker gets the lock; how many reminders went out.

    Timers are read every tick; the todos, a scan of the vault, only when `todos` is set.
    """
    if settings.push_private_key is None:
        return 0
    key = settings.push_private_key.get_secret_value()
    async with engine.connect() as connection:
        if not await connection.scalar(select(func.pg_try_advisory_lock(PUSH_LOCK))):
            return 0
        await connection.commit()
        try:
            async with AsyncSession(bind=connection, expire_on_commit=False) as session:
                sent = await _send_timers(session, client, key, now)
                if todos:
                    sent += await _send_due(session, settings, client, key, now)
                return sent
        finally:
            await connection.execute(select(func.pg_advisory_unlock(PUSH_LOCK)))
            await connection.commit()


def following(timer: PushTimer, now: dt.datetime) -> dt.datetime | None:
    """When a rung timer rings next: the first step of `every` after `now`, or None once done."""
    if timer.every is None:
        return None
    step = dt.timedelta(seconds=timer.every)
    after = timer.due + step * ((now - timer.due) // step + 1)
    return None if timer.until is not None and after > timer.until else after


async def _send_timers(
    session: AsyncSession, client: httpx.AsyncClient, key: str, now: dt.datetime
) -> int:
    """Ring each timer due by `now`, then move a repeat on or remove it, each in its own commit.

    One overdue by `LATE` or more moves on or goes without a push.
    """
    timers = list(
        await session.scalars(
            select(PushTimer).where(PushTimer.due <= now).order_by(PushTimer.due, PushTimer.id)
        )
    )
    sent = 0
    for timer in timers:
        if now - LATE < timer.due:
            message = {
                "title": "kasten",
                "body": timer.label,
                "tag": f"timer-{timer.id}",
                "renotify": True,
            }
            if await _fan_out(session, client, message, key):
                sent += 1
        after = following(timer, now)
        if after is None:
            await session.delete(timer)
        else:
            timer.due = after
        await session.commit()
    return sent


async def _fan_out(
    session: AsyncSession, client: httpx.AsyncClient, message: dict, key: str
) -> bool:
    """Send one message to every device and drop the ones gone; whether any device was there."""
    devices = list(await session.scalars(select(PushDevice)))
    for device in devices:
        status = await _post(client, device, message, key)
        if status in GONE:
            await session.execute(delete(PushDevice).where(PushDevice.id == device.id))
    return bool(devices)


async def _send_due(
    session: AsyncSession, settings: Settings, client: httpx.AsyncClient, key: str, now: dt.datetime
) -> int:
    if await session.scalar(select(func.count()).select_from(PushDevice)) == 0:
        return 0
    zone = ZoneInfo(settings.timezone)
    hours = await session.get(PushSettings, 1) or PushSettings()
    start, end = hours.quiet_start, hours.quiet_end
    quiet = None if start is None or end is None else Quiet(start, end)
    hits = await find_todos(settings.vault_path, settings.archive_path)
    due = [found for found in reminders(hits, zone) if sendable(found.due, now, quiet, zone)]
    morning = _morning(settings, now, hours.morning, quiet, hits)
    sent = await _send_morning(session, client, key, morning)
    for reminder in due:
        if await session.get(PushSent, reminder.key) is not None:
            continue
        message = {
            "title": "kasten",
            "body": reminder.words,
            "path": reminder.path,
            "line": reminder.line,
            "tag": reminder.key,
        }
        await _fan_out(session, client, message, key)
        session.add(PushSent(key=reminder.key, path=reminder.path, due=reminder.due))
        await session.commit()
        sent += 1
    return sent


def _morning(
    settings: Settings,
    now: dt.datetime,
    morning: dt.time | None,
    quiet: Quiet | None,
    hits: list[Hit],
) -> tuple[PushSent, dict] | None:
    """Today's morning push and its record, keyed on the day; None when off, not yet, or empty."""
    zone = ZoneInfo(settings.timezone)
    today = now.astimezone(zone).date()
    if morning is None:
        return None
    at = dt.datetime.combine(today, morning, tzinfo=zone)
    words = today_todos(hits, today)
    if not words or not sendable(at, now, quiet, zone):
        return None
    path = daily_path(today, settings.periodic_path)
    key = hashlib.sha256(f"morning\0{today.isoformat()}".encode()).hexdigest()
    message = {"title": "Today", "body": "\n".join(words), "path": path, "line": 1, "tag": key}
    return PushSent(key=key, path=path, due=at), message


async def _send_morning(
    session: AsyncSession,
    client: httpx.AsyncClient,
    key: str,
    morning: tuple[PushSent, dict] | None,
) -> int:
    """Send the morning push to every device unless it went today already."""
    if morning is None or await session.get(PushSent, morning[0].key) is not None:
        return 0
    record, message = morning
    await _fan_out(session, client, message, key)
    session.add(record)
    await session.commit()
    return 1


async def _post(
    client: httpx.AsyncClient, device: PushDevice, message: dict, key: str
) -> int | None:
    """One device's send; a failure other than a gone device is logged and the device kept."""
    try:
        status = await webpush.send(
            client, device.endpoint, device.p256dh, device.auth, message=message, key=key
        )
    except httpx.HTTPError as error:
        logger.warning("push to device %s failed: %s", device.id, error)
        return None
    if status >= REFUSED and status not in GONE:
        logger.warning("push to device %s answered %s", device.id, status)
    return status


async def running(engine: AsyncEngine, settings: Settings) -> None:
    """Tick until cancelled, which shutdown does; a failed tick waits for the next."""
    async with httpx.AsyncClient(timeout=10) as client:
        for count in itertools.count():
            try:
                now = dt.datetime.now(dt.UTC)
                await tick(engine, settings, client, now, todos=count % TODOS_EVERY == 0)
            except (OSError, SQLAlchemyError, httpx.HTTPError, ValueError) as error:
                logger.warning("push tick failed: %s", error)
            await asyncio.sleep(EVERY_SECONDS)
