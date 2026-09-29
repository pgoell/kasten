"""The captions of one YouTube video, for the editor to write into a note.

`youtube-transcript-api` does the talking to YouTube. It is synchronous, built
on `requests`, and its client holds a `requests.Session`, which is not safe to
share between threads: so a new client is made on every call, and the caller
runs the call off the event loop.
"""

from youtube_transcript_api import FetchedTranscript, YouTubeTranscriptApi


def english(language_code: str) -> bool:
    """Whether a track is English in any region's spelling: `en`, `en-GB`, `en-US`."""
    return language_code.partition("-")[0] == "en"


def read_transcript(video_id: str) -> FetchedTranscript | None:
    """Fetch one video's captions, preferring English written by a person.

    The listing yields every manually written track before every generated one,
    so the first English track in it is a person's where one exists and the
    machine's where not. A video with no English at all gets whatever it has
    first rather than nothing, which is still something to read and search.

    None for a video listing no track at all, which the library answers with an
    empty list rather than an error. Otherwise raises what the library raises,
    and the route decides which of those the reader is told about.
    """
    tracks = list(YouTubeTranscriptApi().list(video_id))
    if not tracks:
        return None
    track = next((track for track in tracks if english(track.language_code)), tracks[0])
    return track.fetch()
