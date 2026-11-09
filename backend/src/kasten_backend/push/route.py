"""The devices push reminders go to: list them, subscribe one, remove one."""

from datetime import datetime  # noqa: TC003  pydantic reads it at runtime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.push import webpush
from kasten_backend.push.models import PushDevice

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
