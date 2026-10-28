"""Where an RSVP run stopped in each vault file, kept in Postgres.

The place lives here rather than in the note's frontmatter because a run saves
on every pause, and a frontmatter write is a jj change each time. Like `finance`
and the token record, it is not rebuilt from the vault: losing it loses reading
places and nothing else.
"""

from datetime import datetime  # noqa: TC003  SQLAlchemy reads `Mapped[...]` at runtime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Integer, Text, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend.db import Base

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class RsvpPlace(Base):
    """One file's reading place: the word a run stopped at and enough to find it again."""

    __tablename__ = "rsvp_places"

    path: Mapped[str] = mapped_column(Text, primary_key=True)
    """The file's vault-relative path, in the vault's own spelling."""

    word: Mapped[int] = mapped_column(Integer, nullable=False)
    """The index of the word the run stopped at."""

    words: Mapped[int] = mapped_column(Integer, nullable=False)
    """How long the word list was at the save, so a client can tell the text changed."""

    anchor: Mapped[str] = mapped_column(Text, nullable=False)
    """The saved word and a few after it, which a client searches for when the text changed."""

    updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


async def read(session: AsyncSession, path: str) -> RsvpPlace | None:
    """The place saved for `path`, or None when no run has stopped in it."""
    return await session.scalar(select(RsvpPlace).where(RsvpPlace.path == path))


async def save(session: AsyncSession, path: str, word: int, words: int, anchor: str) -> RsvpPlace:
    """Write the place for `path` over whatever was there, and return the row.

    One upsert rather than a read and a write, so two devices pausing at once
    cannot both insert. `updated` is set by hand on the update: the server
    default only fires on an insert.
    """
    statement = (
        insert(RsvpPlace)
        .values(path=path, word=word, words=words, anchor=anchor)
        .on_conflict_do_update(
            index_elements=[RsvpPlace.path],
            set_={"word": word, "words": words, "anchor": anchor, "updated": func.now()},
        )
        .returning(RsvpPlace)
    )
    place = (await session.scalars(statement)).one()
    await session.commit()
    return place
