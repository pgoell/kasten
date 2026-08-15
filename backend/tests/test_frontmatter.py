from datetime import UTC, datetime
from uuid import UUID

from kasten_backend.frontmatter import stamp, with_type

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

    assert body(stamp(content, now=NOW)) == content


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
