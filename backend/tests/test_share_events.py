"""The event filter on `/share/events` passes a change to a list and nothing else."""

from kasten_backend import share
from kasten_backend.config import Settings
from kasten_backend.events import VaultEvent


def test_event_filter_passes_a_note_in_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")

    assert share.inside(settings, "05 Shared/Einkauf.md")


def test_event_filter_refuses_a_note_outside_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")

    assert not share.inside(settings, "02 Projects/secret.md")


def test_event_filter_refuses_a_note_deeper_than_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")

    assert not share.inside(settings, "05 Shared/old/Alt.md")


def test_event_filter_refuses_a_page_in_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")
    page = VaultEvent(path="05 Shared/secret.html", change="page", digest="abc")

    assert not share.passes(settings, page)


def test_event_filter_passes_a_list_written_in_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")
    note = VaultEvent(path="05 Shared/Einkauf.md", change="written", digest="abc")

    assert share.passes(settings, note)
