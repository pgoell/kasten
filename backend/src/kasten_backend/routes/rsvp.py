"""The two routes that read and write a file's RSVP reading place."""

from datetime import datetime  # noqa: TC003  pydantic reads the annotation at runtime
from typing import Annotated, Self

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002  FastAPI reads the annotation at runtime
)

from kasten_backend import rsvp
from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.vault import relative_path, resolve_asset, resolve_html, resolve_note

router = APIRouter()


class PlaceEdit(BaseModel):
    """Where a run stopped. The file it belongs to comes from `path` in the query."""

    word: int = Field(ge=0)
    words: int = Field(ge=0)
    anchor: str

    @model_validator(mode="after")
    def word_in_list(self) -> Self:
        """Refuse a word past the end of the list it was counted in.

        `word == words` is allowed: it is the place of a run that read to the end.
        """
        if self.word > self.words:
            raise ValueError("`word` is past `words`")
        return self


class Place(PlaceEdit):
    """A saved place, with the file's path and when it was saved."""

    path: str
    updated: datetime


def file_path(settings: Settings, path: str) -> str:
    """The vault's own spelling of a note, HTML page or asset that is there, or a 404.

    All three, because a run reads any of them. The file has to exist, so a
    typo cannot leave a row behind that nothing will ever read.
    """
    root = settings.vault_path
    found = resolve_note(root, path) or resolve_html(root, path) or resolve_asset(root, path)
    if found is None:
        raise HTTPException(status_code=404, detail="No such file")

    return relative_path(root, found)


def answer(place: rsvp.RsvpPlace) -> Place:
    """The row as the routes answer with it."""
    return Place(
        path=place.path,
        word=place.word,
        words=place.words,
        anchor=place.anchor,
        updated=place.updated,
    )


@router.get("/api/rsvp")
async def read_place(
    path: str,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Place | None:
    """The place a run last stopped at in one file, or `null` when none has.

    `null` rather than a 404, which is kept for a file that is not there: a file
    never read is the usual case, not an error.
    """
    place = await rsvp.read(session, file_path(settings, path))
    return None if place is None else answer(place)


@router.put("/api/rsvp")
async def save_place(
    path: str,
    edit: PlaceEdit,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Place:
    """Save where a run stopped in one file, over the place saved before."""
    place = await rsvp.save(session, file_path(settings, path), edit.word, edit.words, edit.anchor)
    return answer(place)
