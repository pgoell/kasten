"""The YAML block a note carries at the top.

Four fields are kasten's: `id`, which names the note when its path cannot,
`created`, `modified`, and `type`, which says what kind of thing the note is.
Everything else in the block belongs to whoever wrote it and comes through a
save unread, because the vault is the source of truth and this is the one place
the server writes words the user did not type.

Read and written as lines rather than parsed as YAML. A parser would have to
give the block back as text afterwards, and a round trip through one reorders
keys, requotes strings and drops comments: the note would come off disk changed
in ways nobody asked for. Three keys are worth a regex; the rest is copied.
"""

import re
from datetime import UTC, datetime
from uuid import uuid7

FENCE = "---"
"""What opens and closes the block, on a line of its own."""

DEFAULT_TYPE = "Note"
"""What a note is when no writer has said otherwise.

Open Knowledge Format wants a `type` on every concept document, and this is the
honest answer for a note somebody typed into an empty buffer. A writer that
knows better says so itself, and `stamp` never argues with a type already there.
"""

_KEY = re.compile(r"^([A-Za-z_][\w-]*)\s*:")
"""A field's name, at the top level of the block.

Anchored, so an indented line is part of the field above it rather than a field.
That is what carries a list or a nested mapping through untouched.
"""


def _key(line: str) -> str | None:
    """The field `line` sets, or None when it sets none."""
    match = _KEY.match(line)
    return match.group(1) if match else None


def _line(name: str, block: list[str]) -> str | None:
    """The line of `block` setting `name`, or None when no line does."""
    return next((line for line in block if _key(line) == name), None)


def _split(content: str) -> tuple[list[str], list[str]]:
    """The block's lines and the note's, as two lists of lines.

    No block, or an opening fence with no partner, means every line is the
    note's: three dashes alone are a horizontal rule, and reading one as a block
    that never ends would swallow the note under it.
    """
    lines = content.split("\n")
    if lines[0].strip() != FENCE:
        return [], lines

    end = next((i for i, line in enumerate(lines[1:], 1) if line.strip() == FENCE), None)
    if end is None:
        return [], lines

    return lines[1:end], lines[end + 1 :]


def stamp(content: str, previous: str = "", *, now: datetime | None = None) -> str:
    """`content` with its block written: an id, a creation date, a type and this moment.

    `previous` is the note as it stands on disk, and it is where the id, the
    creation date and the type come from when the text being written carries
    none of them. An id is what an ontology will hang off, so it has to survive
    a client that does not know the block is there and a user who deletes it:
    both send the note back without one, and minting a second id would leave the
    note nameable two ways. Every other field is the user's, and one they
    dropped stays dropped.

    `modified` is rewritten where it stands, which leaves the fields around it
    in the order they were written in.

    UTC, and ISO 8601 to the second. The vault outlives the machine's timezone,
    and a note saved twice a second apart is one note, not two versions worth
    telling apart.
    """
    when = (now or datetime.now(UTC)).isoformat(timespec="seconds")
    block, body = _split(content)
    held = _split(previous)[0]

    opening = []
    if _line("id", block) is None:
        opening.append(_line("id", held) or f"id: {uuid7()}")
    if _line("created", block) is None:
        opening.append(_line("created", held) or f"created: {when}")
    if _line("type", block) is None:
        opening.append(_line("type", held) or f"type: {DEFAULT_TYPE}")

    dated = [f"modified: {when}" if _key(line) == "modified" else line for line in block]
    if _line("modified", block) is None:
        dated.append(f"modified: {when}")

    return "\n".join([FENCE, *opening, *dated, FENCE, *body])
