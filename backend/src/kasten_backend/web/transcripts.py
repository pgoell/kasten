"""The captions of one YouTube video, for the editor to write into a note.

The library is synchronous, and its client holds a `requests.Session`, which is not
thread-safe, so a client is made per call and the caller runs it off the event loop.
"""

from youtube_transcript_api import FetchedTranscript, YouTubeTranscriptApi


def english(language_code: str) -> bool:
    """Whether a track is English in any region's spelling: `en`, `en-GB`, `en-US`."""
    return language_code.partition("-")[0] == "en"


def read_transcript(video_id: str) -> FetchedTranscript | None:
    """Fetch one video's captions, preferring English written by a person.

    The listing yields person-written tracks first, so the first English track is a
    person's where one exists. With no English, the first track of any language is used.
    None for a video listing no track. Other library errors propagate to the route.
    """
    tracks = list(YouTubeTranscriptApi().list(video_id))
    if not tracks:
        return None
    track = next((track for track in tracks if english(track.language_code)), tracks[0])
    return track.fetch()
