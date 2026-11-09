"""The devices push reminders go to: list them, subscribe one, remove one; and when pushes go."""

import datetime as dt
from datetime import datetime, time
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_serializer, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend import agent, done_log, share, todo_fields, todos, vault, vcs
from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.push import webpush
from kasten_backend.push.due import CLOSED, put_off
from kasten_backend.push.models import PushDevice, PushSettings

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
    """When the morning and goals pushes go and the quiet hours, None for off.

    Quiet hours need both ends.
    """

    morning: time | None
    quiet_start: time | None
    quiet_end: time | None
    goals: time | None = None

    @model_validator(mode="after")
    def _whole_quiet_hours(self) -> PushHours:
        if (self.quiet_start is None) != (self.quiet_end is None):
            raise ValueError("quiet hours need a start and an end")
        if self.quiet_start is not None and self.quiet_start == self.quiet_end:
            raise ValueError("quiet hours end where they start")
        return self

    @field_serializer("morning", "quiet_start", "quiet_end", "goals")
    def _minutes(self, value: time | None) -> str | None:
        return None if value is None else value.strftime("%H:%M")


@router.get("/settings")
async def read_hours(session: Session) -> PushHours:
    """When pushes go, as `HH:MM`; all None until first saved."""
    hours = await session.get(PushSettings, 1) or PushSettings()
    return PushHours(
        morning=hours.morning,
        quiet_start=hours.quiet_start,
        quiet_end=hours.quiet_end,
        goals=hours.goals,
    )


@router.put("/settings")
async def write_hours(body: PushHours, session: Session) -> PushHours:
    """Store when pushes go; the sender reads it on its next tick."""
    hours = await session.get(PushSettings, 1)
    if hours is None:
        hours = PushSettings(id=1)
        session.add(hours)
    hours.morning, hours.quiet_start, hours.quiet_end, hours.goals = (
        body.morning,
        body.quiet_start,
        body.quiet_end,
        body.goals,
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


CHANGED = "That line has changed since the push: open the note"
TRIES = 3
"""Reads and writes before an act gives up on a note the browser keeps saving."""


class ActIn(BaseModel):
    """A button on a reminder: the note, the todo line's text as pushed, and what to do."""

    path: str = Field(min_length=1)
    text: str = Field(min_length=1)
    action: Literal["done", "tomorrow"]


async def _blocks(settings: Settings, id_: str | None) -> bool:
    """Whether a `⛔` on any todo names `id_`, whose tick the pane would carry to that todo."""
    if id_ is None:
        return False
    for hit in await todos.find_todos(settings.vault_path, settings.archive_path):
        todo = todos.LINE.fullmatch(hit.text)
        rest = todo_fields.mask("" if todo is None else todo[2] or "")
        if any(found[1] == id_ for found in todo_fields.BLOCKED_BY.finditer(rest)):
            return True
    return False


async def _act(settings: Settings, body: ActIn, today: dt.date) -> str | None:
    """Write one act on the line whose text is `body.text`; the done words to log, if any.

    The line is found by its text, as its number may have moved; none or two refuse with 409.
    """
    note = vault.resolve_path(settings.vault_path, body.path)
    raw = note.read_bytes() if note is not None and note.is_file() else b""
    lines = raw.decode("utf-8").split("\n")
    found = [at for at, line in enumerate(lines) if line.removesuffix("\r") == body.text]
    box = None if len(found) != 1 else todos.LINE.fullmatch(body.text)
    if box is None or body.text[len(box[1]) + 3] in CLOSED:
        raise HTTPException(409, CHANGED)
    at, rest = found[0], None
    if body.action == "tomorrow":
        moved = put_off(lines[at], today)
        if moved is None:
            raise HTTPException(409, CHANGED)
        lines[at] = moved
    else:
        if await _blocks(settings, todo_fields.id_of(box[2] or "")):
            raise HTTPException(422, share.TICK_IN_KASTEN)
        try:
            rest = await share.tick_task(settings, body.path, lines, at, today, twins=True)
        except share.TickInKastenError as error:
            raise HTTPException(422, str(error)) from error
    await agent.save_note(settings, body.path, "\n".join(lines), agent.digest(raw))
    return rest


@router.post("/act", status_code=204)
async def act(body: ActIn, settings: VaultSettings) -> Response:
    """`Done` or `Tomorrow` on a reminder, written as the todo pane writes a tick."""
    today = dt.datetime.now(ZoneInfo(settings.timezone)).date()
    held = vcs.writer.set("push")
    try:
        for _ in range(TRIES):
            try:
                rest = await _act(settings, body, today)
            except agent.ConflictError:
                continue
            if rest is not None:
                await done_log.log(settings, body.path, rest, today)
            return Response(status_code=204)
    finally:
        vcs.writer.reset(held)
    raise HTTPException(409, CHANGED)
