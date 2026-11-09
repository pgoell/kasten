"""The devices push reminders go to, when pushes go, and the timers that push."""

from datetime import datetime, time  # noqa: TC003  pydantic reads it at runtime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, Field, field_serializer, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.push import webpush
from kasten_backend.push.models import PushDevice, PushSettings, PushTimer

router = APIRouter(prefix="/api/push")

Session = Annotated[AsyncSession, Depends(get_session)]
VaultSettings = Annotated[Settings, Depends(get_settings)]


class DeviceOut(BaseModel):
    """A subscribed device, without its keys."""

    id: int
    name: str
    endpoint: str
    created: datetime


class PushOut(BaseModel):
    """The key a browser subscribes with, or None where push is not set up, and the devices."""

    public_key: str | None
    devices: list[DeviceOut]


class Keys(BaseModel):
    """The subscription's keys: the browser's public key and the shared secret."""

    p256dh: str = Field(min_length=1)
    auth: str = Field(min_length=1)


class DeviceIn(BaseModel):
    """A browser's `PushSubscription` as `toJSON` gives it, and a name to list it by."""

    endpoint: str = Field(pattern=r"^https://")
    keys: Keys
    name: str = Field(min_length=1, max_length=200)


class TimerIn(BaseModel):
    """A timer to start: its label, when it rings, and for a repeat its seconds apart and end."""

    label: str = Field(min_length=1, max_length=200)
    due: AwareDatetime
    every: int | None = Field(default=None, ge=60)
    until: AwareDatetime | None = None

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> TimerIn:
        if self.until is not None and self.until < self.due:
            raise ValueError("until is before due")
        return self


class TimerOut(BaseModel):
    """A running timer; `due` is when it rings next."""

    id: int
    label: str
    due: datetime
    every: int | None
    until: datetime | None
    created: datetime


def _timer_out(timer: PushTimer) -> TimerOut:
    return TimerOut(
        id=timer.id,
        label=timer.label,
        due=timer.due,
        every=timer.every,
        until=timer.until,
        created=timer.created,
    )


def _out(device: PushDevice) -> DeviceOut:
    return DeviceOut(
        id=device.id, name=device.name, endpoint=device.endpoint, created=device.created
    )


@router.get("")
async def read_push(session: Session, settings: VaultSettings) -> PushOut:
    """The public key and every device, oldest first."""
    key = settings.push_private_key
    devices = await session.scalars(select(PushDevice).order_by(PushDevice.id))
    return PushOut(
        public_key=None if key is None else webpush.public_key(key.get_secret_value()),
        devices=[_out(device) for device in devices],
    )


class PushHours(BaseModel):
    """The morning push's time and the quiet hours, None for off; quiet hours need both ends."""

    morning: time | None
    quiet_start: time | None
    quiet_end: time | None

    @model_validator(mode="after")
    def _whole_quiet_hours(self) -> PushHours:
        if (self.quiet_start is None) != (self.quiet_end is None):
            raise ValueError("quiet hours need a start and an end")
        if self.quiet_start is not None and self.quiet_start == self.quiet_end:
            raise ValueError("quiet hours end where they start")
        return self

    @field_serializer("morning", "quiet_start", "quiet_end")
    def _minutes(self, value: time | None) -> str | None:
        return None if value is None else value.strftime("%H:%M")


@router.get("/settings")
async def read_hours(session: Session) -> PushHours:
    """When pushes go, as `HH:MM`; all None until first saved."""
    hours = await session.get(PushSettings, 1) or PushSettings()
    return PushHours(
        morning=hours.morning, quiet_start=hours.quiet_start, quiet_end=hours.quiet_end
    )


@router.put("/settings")
async def write_hours(body: PushHours, session: Session) -> PushHours:
    """Store when pushes go; the sender reads it on its next tick."""
    hours = await session.get(PushSettings, 1)
    if hours is None:
        hours = PushSettings(id=1)
        session.add(hours)
    hours.morning, hours.quiet_start, hours.quiet_end = (
        body.morning,
        body.quiet_start,
        body.quiet_end,
    )
    await session.commit()
    return body


@router.post("/devices", status_code=201)
async def write_device(body: DeviceIn, session: Session, settings: VaultSettings) -> DeviceOut:
    """Subscribe a device; the same endpoint again updates its keys and name, as one device."""
    if settings.push_private_key is None:
        raise HTTPException(503, "Push is not set up: no KASTEN_PUSH_PRIVATE_KEY")
    device = await session.scalar(select(PushDevice).where(PushDevice.endpoint == body.endpoint))
    if device is None:
        device = PushDevice(endpoint=body.endpoint)
        session.add(device)
    device.p256dh, device.auth, device.name = body.keys.p256dh, body.keys.auth, body.name
    await session.commit()
    await session.refresh(device)
    return _out(device)


@router.delete("/devices/{device_id}", status_code=204)
async def delete_device(device_id: int, session: Session) -> Response:
    """Remove a device, so no push goes to it again."""
    device = await session.get(PushDevice, device_id)
    if device is None:
        raise HTTPException(404, "No such device")
    await session.delete(device)
    await session.commit()
    return Response(status_code=204)


@router.get("/timers")
async def read_timers(session: Session) -> list[TimerOut]:
    """Every running timer, the next to ring first."""
    timers = await session.scalars(select(PushTimer).order_by(PushTimer.due, PushTimer.id))
    return [_timer_out(timer) for timer in timers]


@router.post("/timers", status_code=201)
async def write_timer(body: TimerIn, session: Session, settings: VaultSettings) -> TimerOut:
    """Start a timer; the sender pushes it to every device when it falls due."""
    # Without a key the sender never runs, so a timer would stay listed forever.
    if settings.push_private_key is None:
        raise HTTPException(503, "Push is not set up: no KASTEN_PUSH_PRIVATE_KEY")
    timer = PushTimer(label=body.label, due=body.due, every=body.every, until=body.until)
    session.add(timer)
    await session.commit()
    await session.refresh(timer)
    return _timer_out(timer)


@router.delete("/timers/{timer_id}", status_code=204)
async def delete_timer(timer_id: int, session: Session) -> Response:
    """Stop a timer before it rings, or stop a repeat."""
    timer = await session.get(PushTimer, timer_id)
    if timer is None:
        raise HTTPException(404, "No such timer")
    await session.delete(timer)
    await session.commit()
    return Response(status_code=204)
