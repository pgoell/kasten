"""Every tag written in the vault, for the completion that offers one and for the graph.

rg names the notes holding a hash that could open a tag, and Python reads those
whole, because only a whole note says where a fenced block opens and closes,
and rg reads one line at a time. Each note's tags are then read by
`todos.tags_in`, the reader the todos' `line_tags` sits under, so completion
offers no tag the board, the graph and the editor would not read as one. The
notes are the source of truth, so nothing here is indexed and nothing here can
go stale.
"""

import asyncio
from typing import TYPE_CHECKING

from kasten_backend import todos
from kasten_backend.search import scan_vault
from kasten_backend.vault import read_note

if TYPE_CHECKING:
    from pathlib import Path

MOST_TAGS = 100_000
"""How many tags are read at most, each time one is written counting once.

A vault holding a hundred notes about one thing hits this with a vocabulary of
ten words. It is a backstop against a generated file, the way `MOST_CARDS` is,
and not a limit on how many tags a person may own.
"""


def _read(root: Path, paths: list[str]) -> dict[str, set[str]]:
    """The tags of each note in `paths`, read in path order, up to `MOST_TAGS` in all."""
    tagged: dict[str, set[str]] = {}
    count = 0
    for path in sorted(paths):
        try:
            text = read_note(root, path)
        except UnicodeDecodeError:
            # A note that is not UTF-8 is one the client cannot open either, and
            # it should not empty every other note's tags.
            continue
        # None when the note went between rg naming it and this reading it.
        if text is None:
            continue
        found = todos.tags_in(text)
        tagged[path] = {text[start:end] for start, end in found}
        count += len(found)
        if count >= MOST_TAGS:
            break
    return tagged


MAYBE_TAG = r"(?:^|[^\p{L}\p{N}_/])#[\p{L}\p{N}_/-]"
"""A hash that could open a tag, which a note must hold for it to be read whole.

A superset of the rule, a hash in code included, and narrow enough that a note
whose only hash opens a `# Heading` is not read. A consumed character in front
rather than a lookbehind, because rg's engine has none.
"""


async def tags_by_note(root: Path, skip: str | None = None) -> dict[str, set[str]]:
    """The tags of every note under `root` outside the `skip` folder that holds one."""
    # One match per note is all that says it may hold a tag, and only the match
    # comes back, so a line past the 64 KiB a stream reader takes cannot stop it.
    hits = await scan_vault(
        root, ("--only-matching", "--max-count", "1", "-e", MAYBE_TAG), MOST_TAGS, skip
    )
    paths = list({hit.path for hit in hits})
    # Reading every note with a hash in Python would hold the event loop for the
    # whole of it, where rg above held it for none.
    return await asyncio.to_thread(_read, root, paths)


async def find_tags(root: Path) -> list[str]:
    """Every tag under `root`, once each, sorted.

    The archive is walked too, unlike every other scan here. What is filed away
    is out of a search because it is not what is being looked for; a tag is a
    word you are trying to spell the same way you spelled it last time, and the
    note that taught you the spelling being archived does not unteach it.
    """
    return sorted(set().union(*(await tags_by_note(root)).values()))
