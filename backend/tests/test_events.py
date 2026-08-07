"""What the vault reports when something outside kasten writes it.

The rule here is the listing's rule: an event names a note `GET /api/files`
would show, and nothing else. The vault carries its own jj repo, and every
backend write touches it, so without that rule each save would report its own
bookkeeping back to the editor that caused it.
"""

import hashlib
import json
from typing import TYPE_CHECKING

from watchfiles import Change

from kasten_backend.events import VaultEvent, format_sse, is_watchable, to_events

if TYPE_CHECKING:
    from pathlib import Path


def write(root: Path, path: str, text: str) -> Path:
    note = root / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")
    return note


def test_watchable_note_under_the_vault_root(tmp_path: Path) -> None:
    assert is_watchable(tmp_path, str(tmp_path / "kasten.md"))


def test_watchable_note_inside_a_folder(tmp_path: Path) -> None:
    assert is_watchable(tmp_path, str(tmp_path / "projects" / "kasten.md"))


def test_watchable_skips_the_vaults_own_jj_repo(tmp_path: Path) -> None:
    # The one that matters. jj rewrites its store on every backend write, and
    # each of those files would otherwise be an event of its own.
    assert not is_watchable(tmp_path, str(tmp_path / ".jj" / "repo" / "store" / "blob.md"))


def test_watchable_skips_any_other_hidden_directory(tmp_path: Path) -> None:
    assert not is_watchable(tmp_path, str(tmp_path / ".git" / "MERGE_MSG.md"))


def test_watchable_skips_a_file_that_is_not_markdown(tmp_path: Path) -> None:
    assert not is_watchable(tmp_path, str(tmp_path / "notes.txt"))


def test_to_events_reports_a_new_note_with_its_digest(tmp_path: Path) -> None:
    text = "derived index\n"
    note = write(tmp_path, "kasten.md", text)

    assert to_events(tmp_path, {(Change.added, str(note))}) == [
        VaultEvent(
            path="kasten.md",
            change="added",
            digest=hashlib.sha256(text.encode()).hexdigest(),
        )
    ]


def test_to_events_reports_an_edit_as_written(tmp_path: Path) -> None:
    note = write(tmp_path, "kasten.md", "derived index\n")

    assert to_events(tmp_path, {(Change.modified, str(note))})[0].change == "written"


def test_to_events_reports_a_deletion_without_a_digest(tmp_path: Path) -> None:
    assert to_events(tmp_path, {(Change.deleted, str(tmp_path / "kasten.md"))}) == [
        VaultEvent(path="kasten.md", change="removed", digest=None)
    ]


def test_to_events_spells_the_path_the_way_the_listing_does(tmp_path: Path) -> None:
    note = write(tmp_path, "projects/kasten.md", "derived index\n")

    assert to_events(tmp_path, {(Change.modified, str(note))})[0].path == "projects/kasten.md"


def test_to_events_says_nothing_about_the_jj_repo(tmp_path: Path) -> None:
    blob = write(tmp_path, ".jj/repo/store/blob.md", "derived index\n")

    assert to_events(tmp_path, {(Change.modified, str(blob))}) == []


def test_to_events_reads_a_note_that_vanished_as_a_removal(tmp_path: Path) -> None:
    # The first half of a move: the change fires for a path that is already gone
    # by the time this reads it, which is a removal rather than an error.
    assert to_events(tmp_path, {(Change.added, str(tmp_path / "kasten.md"))}) == [
        VaultEvent(path="kasten.md", change="removed", digest=None)
    ]


def test_format_sse_writes_one_data_line_holding_the_whole_event() -> None:
    line = format_sse(VaultEvent(path="projects/kasten.md", change="written", digest="abc123"))

    assert line.startswith("data: ")
    assert line.endswith("\n\n")
    assert json.loads(line.removeprefix("data: ")) == {
        "path": "projects/kasten.md",
        "change": "written",
        "digest": "abc123",
    }


def test_format_sse_writes_null_for_a_removal() -> None:
    line = format_sse(VaultEvent(path="kasten.md", change="removed", digest=None))

    assert json.loads(line.removeprefix("data: "))["digest"] is None
