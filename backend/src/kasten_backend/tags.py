"""Every tag written in the vault, for the completion that offers one and for the graph.

Each note is read whole by the readers the board uses, so no tag is offered that the editor
would not read. A note is parsed again only when its stamp moves (`vault.note_facts`, #1758).
"""

import asyncio
from typing import TYPE_CHECKING

from kasten_backend import frontmatter, todos
from kasten_backend.search import skipped
from kasten_backend.vault import note_facts

if TYPE_CHECKING:
    from pathlib import Path

MOST_TAGS = 100_000
"""How many tags are read at most. A backstop against a generated file, like `MOST_CARDS`.

Not a limit on how many tags a person may own.
"""


def field_tags(text: str) -> set[str]:
    """The tags the frontmatter's `tags` field names, each with its hash, by the tag rule.

    Obsidian reads a `tags` value with or without a hash: `tags: [a, b/c]` carries `#a`
    and `#b/c`, and `tags: [1984]` carries none, as `#1984` would not in the text.
    """
    found = set()
    for value in frontmatter.tags(text):
        tag = value if value.startswith("#") else f"#{value}"
        if todos.TAG.fullmatch(tag):
            found.add(tag)
    return found


def tags_of(text: str) -> list[str]:
    """The note's tags with their hashes, sorted: its text's tags and its `tags` field's.

    Every reader of a note's tags goes through here, from bytes or from `read_note`.
    """
    # Universal newlines, as `read_note` gives them: a lone CR ends a line (#1570).
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    found = {text[start:end] for start, end in todos.tags_in(text)} | field_tags(text)
    return sorted(found)


def _parse(_path: str, raw: bytes) -> frozenset[str]:
    return frozenset(tags_of(raw.decode("utf-8", "replace")))


def tags_by_note(root: Path, skip: str | None = None) -> dict[str, frozenset[str]]:
    """The tags of every note under `root` outside the `skip` folder, in path order.

    Reads the disk, so call it off the event loop. Stops after `MOST_TAGS` tags.
    """
    tagged: dict[str, frozenset[str]] = {}
    count = 0
    for path, found in note_facts(root, "tags", _parse, frozenset()).items():
        if found and not skipped(path, skip):
            tagged[path] = found
            count += len(found)
            if count >= MOST_TAGS:
                break
    return tagged


def _every_tag(root: Path) -> list[str]:
    return sorted(set().union(*tags_by_note(root).values()))


async def find_tags(root: Path) -> list[str]:
    """Every tag under `root`, once each, sorted.

    The archive is walked too, unlike other scans here: a tag is a spelling you reuse, and
    the note that taught it does not unteach it when archived.
    """
    return await asyncio.to_thread(_every_tag, root)
