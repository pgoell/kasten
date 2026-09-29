"""Reading a YouTube video's captions so the editor can write them into a note.

Nothing here reaches YouTube. The library's client class is swapped for one that
answers from a list of tracks written in the test, which is the boundary the
route talks across: what is tested is which track it picks and what it tells
the reader, not whether YouTube is up today.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

import pytest
from requests import HTTPError
from youtube_transcript_api import (
    AgeRestricted,
    FetchedTranscript,
    FetchedTranscriptSnippet,
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    YouTubeRequestFailed,
)

from kasten_backend import transcripts

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from httpx import AsyncClient

VIDEO = "dQw4w9WgXcQ"


@dataclass
class Track:
    """One caption track as the library lists it, holding its captions already."""

    language_code: str
    is_generated: bool
    lines: list[tuple[float, str]]

    def fetch(self) -> FetchedTranscript:
        return FetchedTranscript(
            snippets=[
                FetchedTranscriptSnippet(text=text, start=start, duration=2.0)
                for start, text in self.lines
            ],
            video_id=VIDEO,
            language=self.language_code,
            language_code=self.language_code,
            is_generated=self.is_generated,
        )


@pytest.fixture
def youtube(monkeypatch: pytest.MonkeyPatch) -> Callable[[list[Track] | Exception], None]:
    """Hand back a way to say what YouTube answers with: some tracks, or a refusal."""

    def use(answer: list[Track] | Exception) -> None:
        class Api:
            # Named for the method it stands in for, which shadows the builtin
            # inside this class body: hence the `Sequence` below.
            def list(self, video_id: str) -> Sequence[Track]:
                assert video_id == VIDEO
                if isinstance(answer, Exception):
                    raise answer
                return answer

        monkeypatch.setattr(transcripts, "YouTubeTranscriptApi", Api)

    return use


async def test_answers_with_the_captions(client: AsyncClient, youtube: Callable) -> None:
    youtube([Track("en", is_generated=False, lines=[(0.0, "Hello"), (2.5, "world &amp; all")])])

    response = await client.get(f"/api/transcripts/{VIDEO}")

    assert response.status_code == 200
    assert response.json() == {
        "language": "en",
        "generated": False,
        "lines": [{"start": 0.0, "text": "Hello"}, {"start": 2.5, "text": "world &amp; all"}],
    }


async def test_prefers_english_written_by_a_person(client: AsyncClient, youtube: Callable) -> None:
    """The listing puts every manual track before every generated one, as the library does."""
    youtube(
        [
            Track("de", is_generated=False, lines=[(0.0, "Hallo")]),
            Track("en-GB", is_generated=False, lines=[(0.0, "Hello")]),
            Track("en", is_generated=True, lines=[(0.0, "hello")]),
        ]
    )

    response = await client.get(f"/api/transcripts/{VIDEO}")

    assert response.json()["language"] == "en-GB"
    assert response.json()["generated"] is False


async def test_falls_back_to_generated_english(client: AsyncClient, youtube: Callable) -> None:
    youtube(
        [
            Track("de", is_generated=False, lines=[(0.0, "Hallo")]),
            Track("en", is_generated=True, lines=[(0.0, "hello")]),
        ]
    )

    response = await client.get(f"/api/transcripts/{VIDEO}")

    assert response.json()["language"] == "en"
    assert response.json()["generated"] is True


async def test_falls_back_to_the_first_track(client: AsyncClient, youtube: Callable) -> None:
    youtube(
        [
            Track("de", is_generated=False, lines=[(0.0, "Hallo")]),
            Track("fr", is_generated=True, lines=[(0.0, "Bonjour")]),
        ]
    )

    response = await client.get(f"/api/transcripts/{VIDEO}")

    assert response.json()["language"] == "de"


@pytest.mark.parametrize(
    ("refusal", "status"),
    [
        (NoTranscriptFound(VIDEO, ["en"], None), 404),
        (TranscriptsDisabled(VIDEO), 404),
        (VideoUnavailable(VIDEO), 404),
        (RequestBlocked(VIDEO), 502),
        # A subclass, and the one YouTube raises for a datacenter address.
        (IpBlocked(VIDEO), 502),
        (YouTubeRequestFailed(VIDEO, HTTPError("429")), 502),
        # Not named in the route: the catch-all for the library's other refusals.
        (AgeRestricted(VIDEO), 404),
    ],
)
async def test_says_why_there_is_nothing_to_read(
    client: AsyncClient, youtube: Callable, refusal: Exception, status: int
) -> None:
    youtube(refusal)

    response = await client.get(f"/api/transcripts/{VIDEO}")

    assert response.status_code == status
    assert response.json()["detail"].endswith(("transcript", "available"))


async def test_a_video_listing_no_track_has_no_transcript(
    client: AsyncClient, youtube: Callable
) -> None:
    youtube([])

    response = await client.get(f"/api/transcripts/{VIDEO}")

    assert response.status_code == 404


@pytest.mark.parametrize(
    "video_id",
    [
        "short",
        "dQw4w9WgXcQx",
        # Eleven characters each, and a host name among them: the length alone
        # is not what keeps an address out.
        "example.com",
        "dQw4w9WgXcé",
    ],
)
async def test_refuses_anything_but_a_video_id(
    client: AsyncClient, youtube: Callable, video_id: str
) -> None:
    """Refused before the library is asked, which the fake would fail on."""
    youtube([])

    response = await client.get(f"/api/transcripts/{video_id}")

    assert response.status_code == 422
