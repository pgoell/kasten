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

RESERVED = frozenset({"index.md", "log.md"})
"""The filenames Open Knowledge Format gives a shape of its own.

One is a listing of the bundle and the other is its history, and neither is a
concept document. Kasten writes no block into either, so the bytes that arrive
are the bytes on disk, and a file named this way never gets an id.
"""

_KEY = re.compile(r"^([A-Za-z_][\w-]*)\s*:")
"""A field's name, at the top level of the block.

Anchored, so an indented line is part of the field above it rather than a field.
That is what carries a list or a nested mapping through untouched.
"""


def reserved(path: str) -> bool:
    """Whether OKF reserves this filename, so kasten writes no block into it.

    The last component, not the whole path: `folder/index.md` is a listing of
    that folder the way `index.md` is a listing of the vault, and asking whether
    the whole path is in `RESERVED` would exempt only the root.
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

    No block, or an opening fence with no partner, means every line is the
    note's: three dashes alone are a horizontal rule, and reading one as a block
    that never ends would swallow the note under it.
    """
    lines = content.split("\n")
    end = _closing(lines)
    if end is None:
        return [], lines

    return lines[1:end], lines[end + 1 :]


def _closing(lines: list[str]) -> int | None:
    """Which line closes the block, or None when there is no block.

    Only a fence at the very start opens one, spaces or tabs after it: ` ---`
    is a horizontal rule to Obsidian and to the editor, and so it is here.
    """
    if lines[0].rstrip(" \t\r") != FENCE:
        return None

    return next((i for i, line in enumerate(lines[1:], 1) if line.strip() == FENCE), None)


def body_start(content: str) -> int:
    """Where the note's own text begins: the offset after the block's closing fence, or 0.

    Not read off `_split`, which hands back no lines both for a note with no
    block and for an empty one, and the second still has two fences to skip.
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

    A single value rather than a list, so it is read off the line as written.
    Quotes are stripped because a writer may quote a timestamp, and nothing else
    is, so the caller decides what the text means.
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
    """The values the block's field `name` holds, in the order it holds them.

    Obsidian's three spellings: a flow list `name: [a, b]`, a block list of
    `- a` lines under the key, and one bare string. Read as lines like the rest
    of this module, so a quoted value loses its quotes and nothing more.
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

    Not `stamp`, and the difference is the point: `stamp` rewrites `modified`,
    which over a whole vault would date every note today. It mints no id and no
    creation date either, because a note written before kasten has a real
    creation date and this is not it. Both arrive on the note's next save.
    """
    block, body = _split(content)
    if _line("type", block) is not None:
        return content

    return "\n".join([FENCE, f"type: {DEFAULT_TYPE}", *block, FENCE, *body])


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


def unstamped(content: str) -> str:
    """`content` with the block's `modified` lines left out, and nothing else changed.

    What a save's base is a hash of. Every save restamps `modified`, so a client
    that sent a text and has not heard back cannot know the line that landed;
    leaving it out lets that client name the note all the same.

    A copy of `unstamped` in frontend/src/lib/held-text.ts, byte for byte, and
    looser about the fence than `_split` on purpose: the two sides hash the
    same text only while they cut it the same way.
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

    A client that sent a text and has not heard back names that text, not the
    one `stamp` made of it. Where the sent text lacked an id, a creation date or
    a type, the disk holds those lines at the head of the block, and where it
    had no block at all, the disk holds one. So the candidates set aside each
    run of leading lines `stamp` could have written, and the whole block when
    nothing but `modified` stays. The body is never set aside.
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
