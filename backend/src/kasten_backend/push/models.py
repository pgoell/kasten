"""The devices a push goes to and the reminders already sent: device state, so Postgres."""

from datetime import datetime  # noqa: TC003  SQLAlchemy reads `Mapped[...]` at runtime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend.db import Base


class PushDevice(Base):
    """One browser's push subscription: where the push service takes a message, and its keys."""

    __tablename__ = "push_devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PushSent(Base):
    """A reminder sent, keyed on its note, time and words so a moved line is still the same one."""

    __tablename__ = "push_sent"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    due: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
