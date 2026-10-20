"""The event filter on `/share/events` passes a change to a list and nothing else."""

from kasten_backend import share
from kasten_backend.config import Settings


def test_event_filter_passes_a_note_in_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")

    assert share.inside(settings, "05 Shared/Einkauf.md")


def test_event_filter_refuses_a_note_outside_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")

    assert not share.inside(settings, "02 Projects/secret.md")


def test_event_filter_refuses_a_note_deeper_than_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")

    assert not share.inside(settings, "05 Shared/old/Alt.md")
