"""Routes that reach past the vault to the internet: a web page, a transcript and the weather."""

import asyncio
from datetime import date
from typing import Annotated
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import Path as Segment
from pydantic import BaseModel
from youtube_transcript_api import (
    CouldNotRetrieveTranscript,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeRequestFailed,
)

from kasten_backend import files
from kasten_backend.config import Settings, get_settings
from kasten_backend.files import PAGE_FAILED, open_public
from kasten_backend.weather import Forecast, in_reach, read_weather
from kasten_backend.web.transcripts import read_transcript

router = APIRouter()

PAGE_LIMIT_BYTES = 8 * 1024 * 1024
"""The most of one web page this reads into memory before giving up.

`content-length` is a claim from a stranger, so the bytes are counted as they arrive.
"""


class Page(BaseModel):
    """One web page as it arrived, for the client to make a note out of."""

    url: str
    """Where the page finally came from, redirects followed.

    Not the address that was asked for. A page's relative links are relative to
    this, and the client resolves them.
    """

    html: str
    """The page's markup, untouched."""


class CaptionLine(BaseModel):
    """One caption as YouTube shows it: when it appears, and what it says."""

    start: float
    """Seconds into the video."""

    text: str
    """The caption's text, as YouTube wrote it.

    Entities and line breaks included. The client decodes and joins them while
    it writes the note, which is where the text is turned into prose anyway.
    """


class Transcript(BaseModel):
    """The captions of one video, and which of its tracks they came from."""

    language: str
    """The track's language code, `en` or `en-GB` or `de`."""

    generated: bool
    """Whether YouTube's speech recognition wrote the track rather than a person."""

    lines: list[CaptionLine]


@router.get("/api/fetch")
async def fetch_page(url: str) -> Page:
    """Read one web page off the internet and hand it back unchanged, for defuddle to read."""
    if urlsplit(url).scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http and https addresses")

    try:
        async with files.reader() as client:
            response = await open_public(client, url)
            try:
                return await _read_page(response)
            finally:
                await response.aclose()
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"Could not read that page: {error}") from error


async def _read_page(response: httpx.Response) -> Page:
    """Turn the response a fetch ended at into the page the reader gets."""
    # Read rather than raised for, so the reader sees the number, not httpx's paragraph.
    # The prompt puts this sentence on screen.
    if response.status_code >= PAGE_FAILED:
        raise HTTPException(status_code=502, detail=f"That page answered {response.status_code}")

    if "html" not in response.headers.get("content-type", ""):
        raise HTTPException(status_code=415, detail="That address is not a web page")

    # Streamed, so the count below stops a page that never ends.
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body += chunk
        if len(body) > PAGE_LIMIT_BYTES:
            raise HTTPException(status_code=502, detail="That page is too big to read")

    # The header's charset, else utf-8: right for most pages that declare it in a meta tag.
    # A replaced character is a typo; a raised decode error would be no note at all.
    html = body.decode(response.charset_encoding or "utf-8", errors="replace")
    return Page(url=str(response.url), html=html)


@router.get("/api/transcripts/{video_id}")
async def fetch_transcript(
    video_id: Annotated[str, Segment(pattern=r"^[A-Za-z0-9_-]{11}$")],
) -> Transcript:
    """Read the captions of one YouTube video, named by its eleven-character id."""
    try:
        # The library is synchronous and a fetch is two or three round trips to
        # YouTube, so it runs on a worker thread rather than holding the loop.
        fetched = await asyncio.to_thread(read_transcript, video_id)
    except (NoTranscriptFound, TranscriptsDisabled) as error:
        raise HTTPException(status_code=404, detail="That video has no transcript") from error
    except VideoUnavailable as error:
        raise HTTPException(status_code=404, detail="That video is not available") from error
    except (RequestBlocked, YouTubeRequestFailed) as error:
        raise HTTPException(
            status_code=502, detail="YouTube refused to hand over the transcript"
        ) from error
    except CouldNotRetrieveTranscript as error:
        # The library's other refusals (an age gate, say) are about the video, not a failed ask.
        raise HTTPException(status_code=404, detail="That video has no transcript") from error
    if fetched is None:
        raise HTTPException(status_code=404, detail="That video has no transcript")

    return Transcript(
        language=fetched.language_code,
        generated=fetched.is_generated,
        lines=[CaptionLine(start=line.start, text=line.text) for line in fetched],
    )


@router.get("/api/weather")
async def read_day_weather(
    day: Annotated[date, Query(alias="date")], settings: Annotated[Settings, Depends(get_settings)]
) -> list[Forecast]:
    """The weather on one day, hour by hour, for each place the settings name."""
    if not in_reach(day, date.today()):
        raise HTTPException(status_code=404, detail="No weather for that day")
    try:
        return await read_weather(day, settings.weather_places)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Open-Meteo did not answer") from error
