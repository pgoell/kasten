"""Every tag written in the vault, for the completion that offers one and for the graph.

Two rg passes. One matches every span and every hash that could open a tag, and
each match is read by `todos.line_tags`, as the board reads a todo's line. The
other names the notes that may hold a fenced block, and those are read whole by
`todos.tags_in` instead, because only a whole note says where a fence opens and
closes, and rg reads one line at a time. Either way the reader is the one the
board, the graph and the mentions use, so completion offers no tag the editor
would not read as one. The notes are the source of truth, so nothing here is
indexed and nothing here can go stale.
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

MOST_MATCHES = 2_000_000
"""How many spans and could-be tags the line pass reads at most.

Its own backstop and far above `MOST_TAGS`, because most of what it matches is
links and code, which are no tags. Stopping it at `MOST_TAGS` would kill rg
part way through a parallel walk, and which notes lost their tags would differ
from one call to the next.
"""


def _read(root: Path, paths: list[str]) -> dict[str, set[str]]:
    """The tags of each note in `paths`, read in path order, up to `MOST_TAGS` in all."""
    tagged: dict[str, set[str]] = {}
    count = 0
    for path in sorted(paths):
        try:
            text = read_note(root, path)
        except UnicodeDecodeError, OSError:
            # A note that is not UTF-8 is one the client cannot open either, and
            # one deleted or locked since rg named it is one it cannot reach;
            # neither should empty every other note's tags.
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


_RUN = r"#[\p{L}\p{N}_/-]+"
_SPAN_OR_TAG = rf"(?:{todos.SPANS.pattern})(?:{_RUN})?|(?:^|[^\p{{L}}\p{{N}}_/]){_RUN}"
"""A span or what could be a tag, the span tried first at each place, as rg alternates.

A superset of the rule, numbers alone included, which `todos.line_tags` then
narrows on each match. The character in front of the hash is consumed rather
than looked behind, because rg's engine has no lookbehind. A span is consumed
whole, so no hash inside one comes back on its own, and a tag straight after a
span rides along with it, the span masked to no word in front of the hash.
"""

FENCE = r"```|~~~"
"""Three backticks or tildes anywhere on a line: a superset of a fence opening.

A note holding one is read whole instead, since only the whole note says where
the fence ends. Unanchored, so a fence in a list item or a blockquote is caught
too, and the cost of a wrong guess is one note read rather than a wrong tag.
"""


async def tags_by_note(root: Path, skip: str | None = None) -> dict[str, set[str]]:
    """The tags of every note under `root` outside the `skip` folder that holds one."""
    # Only the matches come back, so a line past the 64 KiB a stream reader
    # takes, a pasted inline SVG, cannot stop either scan.
    matches, fences = await asyncio.gather(
        scan_vault(root, ("--only-matching", "-e", _SPAN_OR_TAG), MOST_MATCHES, skip),
        scan_vault(root, ("--only-matching", "--max-count", "1", "-e", FENCE), MOST_MATCHES, skip),
    )
    fenced = {hit.path for hit in fences}
    tagged: dict[str, set[str]] = {}
    for hit in matches:
        if hit.path not in fenced:
            found = {hit.text[start:end] for start, end in todos.line_tags(hit.text)}
            tagged.setdefault(hit.path, set()).update(found)
    # Reading the fenced notes in Python would hold the event loop for the whole
    # of it, where rg above held it for none.
    tagged.update(await asyncio.to_thread(_read, root, sorted(fenced)))
    return tagged


async def find_tags(root: Path) -> list[str]:
    """Every tag under `root`, once each, sorted.

    The archive is walked too, unlike every other scan here. What is filed away
    is out of a search because it is not what is being looked for; a tag is a
    word you are trying to spell the same way you spelled it last time, and the
    note that taught you the spelling being archived does not unteach it.
    """
    return sorted(set().union(*(await tags_by_note(root)).values()))
