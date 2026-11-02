"""The YAML block a note carries at the top.

Four fields are kasten's: `id`, `created`, `modified` and `type`. Everything else is copied
through a save unread. Read as lines, not parsed: a YAML round trip reorders keys, requotes
strings and drops comments.
"""

import re
from datetime import UTC, datetime
from uuid import uuid7

FENCE = "---"
"""What opens and closes the block, on a line of its own."""

DEFAULT_TYPE = "Note"
"""What a note is when no writer has said otherwise.

Open Knowledge Format wants a `type` on every concept document. A writer that knows better says
so, and `stamp` never overrides a type already there.
"""

RESERVED = frozenset({"index.md", "log.md"})
"""The filenames Open Knowledge Format gives a shape of its own.

A listing and a history, neither a concept document. Kasten writes no block into them, so they
never get an id.
"""

_KEY = re.compile(r"^([A-Za-z_][\w-]*)\s*:")
"""A field's name, at the top level of the block.

Anchored, so an indented line belongs to the field above it. That carries a list or a nested
mapping through untouched.
"""


def reserved(path: str) -> bool:
    """Whether OKF reserves this filename, so kasten writes no block into it.

    Only the last component counts: `folder/index.md` is a listing too, like the vault's own.
    """
    return path.rsplit("/", 1)[-1] in RESERVED


def _key(line: str) -> str | None:
    """The field `line` sets, or None when it sets none."""
    match = _KEY.match(line)
    return match.group(1) if match else None


def _line(name: str, block: list[str]) -> str | None:
    """The line of `block` setting `name`, or None when no line does."""
    return next((line for line in block if _key(line) == name), None)


def _split(content: str) -> tuple[list[str], list[str]]:
    """The block's lines and the note's, as two lists of lines.

    No block, or an opening fence with no partner, means every line is the note's. A lone `---`
    is a horizontal rule, and read as an open block it would swallow the note under it.
    """
    lines = content.split("\n")
    end = _closing(lines)
    if end is None:
        return [], lines

    return lines[1:end], lines[end + 1 :]


def _closing(lines: list[str]) -> int | None:
    """Which line closes the block, or None when there is no block.

    A fence opens or closes one only at column 0, with spaces or tabs after it. ` ---` is a rule
    to Obsidian and the editor, so it is one here too (#654).
    """
    if not _fence(lines[0]):
        return None

    return next((i for i, line in enumerate(lines[1:], 1) if _fence(line)), None)


def _fence(line: str) -> bool:
    """Whether `line` opens or closes a block. Cases shared with the client in
    backend/tests/fixtures/frontmatter_closers.json."""
    return line.rstrip(" \t\r") == FENCE


def body_start(content: str) -> int:
    """Where the note's own text begins: the offset after the block's closing fence, or 0.

    Not from `_split`, which gives no lines both for a note with no block and for an empty one.
    """
    lines = content.split("\n")
    end = _closing(lines)
    if end is None:
        return 0

    return min(len(content), sum(len(line) + 1 for line in lines[: end + 1]))


def aliases(content: str) -> list[str]:
    """The other names the block gives the note, in the order it gives them."""
    return _list(content, "aliases")


def tags(content: str) -> list[str]:
    """The tags the block's `tags` field gives the note, as written, a hash or none."""
    return _list(content, "tags")


def created(content: str) -> str | None:
    """The block's `created` field as it is written, or None when the block has none.

    Quotes are stripped, since a writer may quote a timestamp. Nothing else is.
    """
    block, _ = _split(content)
    line = _line("created", block)
    if line is None:
        return None

    return line.partition(":")[2].strip().strip("\"'") or None


def description(content: str) -> str:
    """The block's `description` field as it is written, quotes stripped, or empty.

    What a skill's SKILL.md says it is for. A single line, as `created` is read.
    """
    block, _ = _split(content)
    line = _line("description", block)
    if line is None:
        return ""

    return line.partition(":")[2].strip().strip("\"'")


def _list(content: str, name: str) -> list[str]:
    """The values the block's field `name` holds, in order.

    Obsidian's three spellings: a flow list, a block list of `- a` lines under the key, and one
    bare string. Read as lines, so a quoted value loses its quotes and nothing more.
    """
    block, _ = _split(content)
    index = next((i for i, line in enumerate(block) if _key(line) == name), None)
    if index is None:
        return []

    value = block[index].partition(":")[2].strip()
    if value.startswith("[") and value.endswith("]"):
        items = value[1:-1].split(",")
    elif value:
        items = [value]
    else:
        items = []
        for line in block[index + 1 :]:
            item = line.strip()
            # A list item may sit at the key's own indent in YAML, so the next
            # key, not the next unindented line, is what ends the list.
            if _key(line) is not None or not item.startswith("-"):
                break
            items.append(item[1:])

    names = [item.strip().strip("\"'").strip() for item in items]
    return [name for name in names if name]


def with_type(content: str) -> str:
    """`content` with `type: Note` written where its block has none, and nothing else changed.

    Not `stamp`, which rewrites `modified`: over a vault that would date every note today. It
    mints no id or creation date either, since a note written before kasten has a real one.
    """
    block, body = _split(content)
    if _line("type", block) is not None:
        return content

    return "\n".join([FENCE, f"type: {DEFAULT_TYPE}", *block, FENCE, *body])


def stamp(content: str, previous: str = "", *, now: datetime | None = None) -> str:
    """`content` with its block written: an id, a creation date, a type and this moment.

    `previous` is the note on disk. The id, creation date and type come from it when the text
    lacks them, so an id survives a client that drops the block. Every other field is the user's.
    UTC, to the second, as the vault outlives the machine's timezone.
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


def unstamped(content: str) -> str:
    """`content` with the block's `modified` lines left out, and nothing else changed.

    What a save's base hashes. A client that has not heard back cannot know the restamped
    `modified` line, so leaving it out lets it still name the note. A copy lives in
    frontend/src/lib/held-text.ts, byte for byte, and must cut the fence as this does.
    """
    if not content.startswith("---\n"):
        return content
    end = content.find("\n---", 4)
    if end == -1:
        return content
    block = [line for line in content[4:end].split("\n") if not line.startswith("modified:")]
    return "---\n" + "\n".join(block) + content[end:]


_OPENING = ("id", "created", "type")
"""The fields `stamp` writes at the head of the block, in the order it writes them."""


def bases(content: str) -> list[str]:
    """Every text a save's base may hash to over `content`, `unstamped(content)` first.

    A client names the text it sent, not the one `stamp` made of it. Where that text lacked
    `id`, `created` or `type`, the disk holds them at the head of the block, so each run of
    leading lines `stamp` could write is set aside, and the whole block when only `modified` is.
    """
    found = [unstamped(content)]
    block, body = _split(content)
    left = list(_OPENING)
    for count, line in enumerate(block[: len(_OPENING)], 1):
        key = _key(line)
        if key not in left:
            break
        del left[: left.index(key) + 1]
        rest = block[count:]
        found.append(unstamped("\n".join([FENCE, *rest, FENCE, *body])))
        if count == len(_OPENING) and [_key(field) for field in rest] == ["modified"]:
            found.append("\n".join(body))
    return found
