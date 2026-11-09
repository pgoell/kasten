"""The sender: each minute, every reminder due in the last hour goes to every device, once.

One worker sends, the one holding the advisory lock. A reminder is recorded as sent in the
same transaction as its send, so a restart neither repeats one nor drops it.
"""

import asyncio
import datetime as dt
import logging
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from kasten_backend.push import webpush
from kasten_backend.push.due import reminders
from kasten_backend.push.models import PushDevice, PushSent
from kasten_backend.todos import find_todos

if TYPE_CHECKING:
    from kasten_backend.config import Settings

logger = logging.getLogger(__name__)

PUSH_LOCK = 0x6B70_7573
"""The advisory lock one sender holds for a tick, `kpus` in ASCII, apart from the finance locks."""
LATE = dt.timedelta(hours=1)
"""How late a missed reminder may still go out; an older one is dropped."""
GONE = {404, 410}
REFUSED = 300
EVERY_SECONDS = 60


async def tick(
    engine: AsyncEngine, settings: Settings, client: httpx.AsyncClient, now: dt.datetime
) -> int:
    """Send what is due at `now` if this worker gets the lock; how many reminders went out."""
    if settings.push_private_key is None:
        return 0
    key = settings.push_private_key.get_secret_value()
    async with engine.connect() as connection:
        if not await connection.scalar(select(func.pg_try_advisory_lock(PUSH_LOCK))):
            return 0
        await connection.commit()
        try:
            async with AsyncSession(bind=connection, expire_on_commit=False) as session:
                return await _send_due(session, settings, client, key, now)
        finally:
            await connection.execute(select(func.pg_advisory_unlock(PUSH_LOCK)))
            await connection.commit()


async def _send_due(
    session: AsyncSession, settings: Settings, client: httpx.AsyncClient, key: str, now: dt.datetime
) -> int:
    devices = list(await session.scalars(select(PushDevice)))
    if not devices:
        return 0
    zone = ZoneInfo(settings.timezone)
    hits = await find_todos(settings.vault_path, settings.archive_path)
    due = [found for found in reminders(hits, zone) if now - LATE < found.due <= now]
    sent = 0
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
        for device in devices:
            status = await _post(client, device, message, key)
            if status in GONE:
                await session.execute(delete(PushDevice).where(PushDevice.id == device.id))
        devices = list(await session.scalars(select(PushDevice)))
        session.add(PushSent(key=reminder.key, path=reminder.path, due=reminder.due))
        await session.commit()
        sent += 1
    return sent


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
    """Tick each minute until cancelled, which shutdown does; a failed tick waits for the next."""
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            try:
                await tick(engine, settings, client, dt.datetime.now(dt.UTC))
            except (OSError, SQLAlchemyError, httpx.HTTPError, ValueError) as error:
                logger.warning("push tick failed: %s", error)
            await asyncio.sleep(EVERY_SECONDS)
