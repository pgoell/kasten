import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest

from kasten_backend import model_use_notes
from kasten_backend.frontmatter import _split, bases, body_start, stamp, unstamped, with_type
from kasten_backend.log_config import parse_config

NOW = datetime(2026, 8, 6, 12, 0, tzinfo=UTC)
LATER = datetime(2026, 8, 6, 13, 30, tzinfo=UTC)


def fields(content: str) -> dict[str, str]:
    """The block's keys and values, for a test that does not care about order."""
    lines = content.split("\n")
    assert lines[0] == "---"
    return dict(line.split(": ", 1) for line in lines[1 : lines.index("---", 1)])


def body(content: str) -> str:
    """Everything below the block."""
    lines = content.split("\n")
    return "\n".join(lines[lines.index("---", 1) + 1 :])


def test_writes_a_block_over_a_note_that_has_none() -> None:
    stamped = stamp("# index\n\nText.\n", now=NOW)

    assert body(stamped) == "# index\n\nText.\n"
    assert fields(stamped).keys() == {"id", "created", "type", "modified"}


def test_names_the_note_with_a_uuid7() -> None:
    # Version 7 for the reason a note is dated at all: it sorts by when it was
    # made, so an ontology built on these ids reads in the order they arrived.
    identifier = UUID(fields(stamp("", now=NOW))["id"])

    assert identifier.version == 7


def test_dates_a_new_block_from_the_clock() -> None:
    made = fields(stamp("", now=NOW))

    assert made["created"] == "2026-08-06T12:00:00+00:00"
    assert made["modified"] == "2026-08-06T12:00:00+00:00"


def test_keeps_the_id_and_the_creation_date_a_note_already_has() -> None:
    first = stamp("# index", now=NOW)

    second = stamp(first, now=LATER)

    assert fields(second)["id"] == fields(first)["id"]
    assert fields(second)["created"] == "2026-08-06T12:00:00+00:00"
    assert fields(second)["modified"] == "2026-08-06T13:30:00+00:00"


def test_keeps_every_other_field_where_it_was() -> None:
    # What the block is for: the fields kasten manages are managed, and anything
    # else in it is the user's and comes through a save unread. The type is the
    # one the note had none of, so it opens the block the way a missing id would.
    note = "---\nid: kept\ncreated: then\ntags:\n  - reading\n  - 2026\nmodified: old\n---\n# index"

    stamped = stamp(note, now=NOW)

    assert stamped == (
        "---\ntype: Note\nid: kept\ncreated: then\ntags:\n  - reading\n  - 2026\n"
        f"modified: {NOW.isoformat()}\n---\n# index"
    )


def test_reads_an_unclosed_block_as_text() -> None:
    # Three dashes with no partner is a horizontal rule, not a block, and
    # writing into it would swallow the note under it.
    stamped = stamp("---\n# index", now=NOW)

    assert body(stamped) == "---\n# index"


def test_leaves_the_body_alone_to_the_byte() -> None:
    content = "# Grüße\r\n\r\nNo trailing newline."

    stamped = stamp(content, now=NOW)

    # A CRLF text gets its block in CRLF too (#1470), so the cut is the closer's own.
    assert stamped[body_start(stamped) :] == content


def test_takes_the_id_and_the_creation_date_from_the_note_on_disk() -> None:
    # The client sends the note without its block, which every client that does
    # not know about one does. Minting a second id would leave the note nameable
    # two ways, and that is the one thing the id is for.
    held = stamp("# index", now=NOW)

    stamped = stamp("# index\n\nEdited.", held, now=LATER)

    assert fields(stamped)["id"] == fields(held)["id"]
    assert fields(stamped)["created"] == "2026-08-06T12:00:00+00:00"
    assert fields(stamped)["modified"] == "2026-08-06T13:30:00+00:00"


def test_lets_a_dropped_field_stay_dropped() -> None:
    # Only the ones kasten manages come back. The rest of the block is the
    # user's, and deleting a line there is an edit like any other.
    held = "---\nid: kept\ncreated: then\ntags:\n  - reading\n---\n# index"

    stamped = stamp("# index", held, now=NOW)

    assert fields(stamped) == {
        "id": "kept",
        "created": "then",
        "type": "Note",
        "modified": NOW.isoformat(),
    }


def test_types_a_new_note_a_note() -> None:
    # OKF asks every concept document what kind of thing it is, and the honest
    # answer for a note nobody has said anything else about is `Note`.
    assert fields(stamp("", now=NOW))["type"] == "Note"


def test_keeps_the_type_the_incoming_block_carries() -> None:
    stamped = stamp("---\ntype: Source\n---\n", now=NOW)

    assert fields(stamped)["type"] == "Source"
    assert "type: Note" not in stamped


def test_takes_the_type_from_the_note_on_disk() -> None:
    # Same rescue the id gets, and for the same reason: a client that does not
    # know the block is there sends the note back without one.
    held = "---\ntype: Source\n---\n"

    stamped = stamp("---\nauthor: x\n---\n", held, now=NOW)

    assert fields(stamped)["type"] == "Source"
    assert "type: Note" not in stamped


def test_types_a_note_that_has_no_block_at_all() -> None:
    typed = with_type("# borges\n")

    assert typed == "---\ntype: Note\n---\n# borges\n"


def test_types_a_note_without_disturbing_the_block_it_has() -> None:
    typed = with_type("---\nid: x\n---\n# borges\n")

    assert typed == "---\ntype: Note\nid: x\n---\n# borges\n"
    assert typed.count("id: x") == 1


def test_leaves_a_typed_note_byte_for_byte_alone() -> None:
    # Not `stamp`, and this is the difference: `stamp` rewrites `modified`,
    # which over a whole vault would date every note today.
    content = "---\ntype: Source\n---\n"

    assert with_type(content) == content


def test_651_a6_a_fence_after_a_space_opens_no_block() -> None:
    # ` ---` is a horizontal rule to Obsidian and the editor, so what follows
    # it is the note's text and its hash a tag.
    content = ' ---\ncolor: "#fff"\n---\n'

    assert {"body": body_start(content), "split": _split(content)} == {
        "body": 0,
        "split": ([], content.split("\n")),
    }


def test_651_i7_a_save_puts_the_block_above_a_note_opening_with_a_spaced_fence() -> None:
    content = ' ---\ncolor: "#fff"\n---\n'

    stamped = stamp(content, now=NOW)

    assert {"fields": set(fields(stamped)), "body": body(stamped)} == {
        "fields": {"id", "created", "type", "modified"},
        "body": content,
    }


CLOSERS = json.loads(
    (Path(__file__).parent / "fixtures/frontmatter_closers.json").read_text(encoding="utf-8")
)
"""#654: which line closes a block, the cases `frontend/tests/note-frontmatter.test.ts` runs too."""


@pytest.mark.parametrize("case", CLOSERS, ids=[case["name"] for case in CLOSERS])
def test_654_a_block_closes_only_on_a_fence_at_column_0(case: dict) -> None:
    note = case["note"]

    assert {
        "split": "\n".join(_split(note)[1]),
        "body_start": note[body_start(note) :],
        "model_use": "\n".join(model_use_notes._split(note)[1]),
    } == dict.fromkeys(("split", "body_start", "model_use"), case["body"])


def _marked(note: str, mark: str) -> str:
    """`note` with each line that starts no dash swapped for `mark` and its index, `\r` kept."""
    lines = note.split("\n")
    return "\n".join(
        line if line.lstrip().startswith("-") else f"{mark}{i}" + "\r" * line.endswith("\r")
        for i, line in enumerate(lines)
    )


@pytest.mark.parametrize("case", CLOSERS, ids=[case["name"] for case in CLOSERS])
def test_1449_every_reader_reads_below_the_closer_frontmatter_py_finds(case: dict) -> None:
    lines = case["note"].split("\n")
    start = len(lines) - len(case["body"].split("\n"))
    below = {i for i, line in enumerate(lines[start:], start) if not line.lstrip().startswith("-")}
    kept = unstamped(_marked(case["note"], "modified: L")).split("\n")
    broken = parse_config(_marked(case["note"], "- L")).broken

    assert {
        "log_config": {number - 1 for number, _ in broken},
        "unstamped": {int(line.strip()[11:]) for line in kept if line.startswith("modified: L")},
    } == dict.fromkeys(("log_config", "unstamped"), below)


def test_1449_unstamped_keeps_the_bytes_of_a_plain_a_modified_only_and_an_empty_block() -> None:
    assert [
        unstamped("---\nid: a\nmodified: x\n---\nb"),
        unstamped("---\nmodified: x\n---\nb"),
        unstamped("---\n---\nb"),
    ] == ["---\nid: a\n---\nb", "---\n\n---\nb", "---\n---\nb"]


def test_654_a_save_puts_the_block_above_a_note_closed_only_by_a_spaced_fence() -> None:
    content = "---\nref: x #a\n ---\n#real"

    stamped = stamp(content, now=NOW)

    assert {"fields": set(fields(stamped)), "body": body(stamped)} == {
        "fields": {"id", "created", "type", "modified"},
        "body": content,
    }


@pytest.mark.parametrize("closer", ["--- ", "---\t", "---\r"])
def test_1468_a_save_keeps_a_closer_with_trailing_blanks(closer: str) -> None:
    note = f"---\nid: a\ncreated: x\ntype: Note\nmodified: y\n{closer}\nbody"

    assert unstamped(stamp(note, note)) == unstamped(note)


def test_1570_a_note_whose_lines_end_in_a_lone_carriage_return_has_a_block() -> None:
    note = "---\rid: a\rtags: [x]\r---\rbody\r"

    assert (_split(note), note[body_start(note) :]) == (
        (["id: a", "tags: [x]"], ["body", ""]),
        "body\r",
    )


def test_1570_stamp_joins_a_lone_carriage_return_text_with_carriage_returns() -> None:
    now = datetime(2026, 11, 5, tzinfo=UTC)

    assert stamp("---\rid: a\r---\rbody\r", now=now) == (
        "---\rcreated: 2026-11-05T00:00:00+00:00\rtype: Note\rid: a\r"
        "modified: 2026-11-05T00:00:00+00:00\r---\rbody\r"
    )
    assert "\n" not in stamp("one\rtwo", now=now)
    assert stamp("one\rtwo", now=now).endswith("\r---\rone\rtwo")


def test_1570_with_type_joins_a_lone_carriage_return_text_with_carriage_returns() -> None:
    assert with_type("---\rid: a\r---\rbody\r") == "---\rtype: Note\rid: a\r---\rbody\r"


def test_1572_a_text_with_a_lone_cr_and_an_lf_has_its_block() -> None:
    note = "---\rid: a\rcolor: #x\r---\nbody\n"

    assert (_split(note), note[body_start(note) :]) == (
        (["id: a", "color: #x"], ["body", ""]),
        "body\n",
    )


def test_1572_stamp_writes_one_block_into_a_mixed_text() -> None:
    stamped = stamp("---\rid: a\rcolor: #x\r---\nbody\n", now=NOW)

    assert stamped == (
        "---\rcreated: 2026-08-06T12:00:00+00:00\rtype: Note\rid: a\rcolor: #x\r"
        "modified: 2026-08-06T12:00:00+00:00\r---\nbody\n"
    )


def test_1572_stamp_keeps_a_lone_cr_in_the_body() -> None:
    content = "---\nid: a\n---\nfoo\rbar\nbaz\n"

    assert stamp(content, now=NOW).endswith("---\nfoo\rbar\nbaz\n")
    assert with_type(content) == "---\ntype: Note\nid: a\n---\nfoo\rbar\nbaz\n"


def test_1572_body_start_and_unstamped_agree_on_a_mixed_text() -> None:
    note = "---\rid: a\rmodified: x\r---\nbody\n"

    assert note[body_start(note) :] == "body\n"
    assert unstamped(note) == "---\rid: a\r---\nbody\n"


def test_1572_bases_of_a_stamped_mixed_text_holds_the_body() -> None:
    stamped = stamp("---\r---\nfoo\rbar\n", now=NOW)

    assert bases(stamped)[-1] == "foo\rbar\n"


def test_1572_stamp_writes_no_doubled_cr_into_a_text_led_by_a_lone_cr() -> None:
    stamped = stamp("---\ra: b\r\n---\r\nbody\r", now=NOW)

    assert "\r\r" not in stamped
    assert unstamped("---\ra: b\r\n---\r\nbody\r") in bases(stamped)


def test_1572_stamp_reads_a_crlf_text_with_a_lone_cr_as_not_crlf_throughout() -> None:
    note = "---\r\na: b\r\r---\r"

    assert unstamped(note) in bases(stamp(note, now=NOW))
