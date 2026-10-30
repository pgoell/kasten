"""Finding the notes that name a note in plain text without linking to it.

Obsidian's unlinked mentions: the title and each alias, matched whole and ignoring case, outside
links, code, tags and frontmatter. rg finds candidate notes; Python reads those few.
"""

import asyncio
import re
from bisect import bisect_right
from typing import TYPE_CHECKING, NamedTuple

from kasten_backend.code_spans import WIKILINK, code_spans
from kasten_backend.frontmatter import aliases, body_start
from kasten_backend.links import MARKDOWN_LINK, SUFFIX
from kasten_backend.search import notes_holding
from kasten_backend.todos import tags_in
from kasten_backend.vault import read_note

if TYPE_CHECKING:
    from pathlib import Path

MOST_MENTIONS = 1_000
"""How many mentions come back at most.

Nothing ranks these afterwards, so the cap is the list the pane shows. A name like `Notes` can sit
on most lines of a large vault, and past a thousand rows nobody reads down the list.
"""


class Mention(NamedTuple):
    """One name on one line: where it is, the line, and which name it was."""

    path: str
    line: int
    text: str
    start: int
    end: int
    name: str


def names(path: str, content: str) -> list[str]:
    """The note's title and then its aliases, each once whatever its case."""
    title = path.rsplit("/", 1)[-1].removesuffix(SUFFIX)
    seen: set[str] = set()
    found = []
    for name in [title, *aliases(content)]:
        if name.casefold() not in seen:
            seen.add(name.casefold())
            found.append(name)
    return found


def matcher(ordered: list[str]) -> re.Pattern[str]:
    r"""One pattern for every name, each its own group so a match says which name it was.

    The boundary is no letter or digit, not `\\b`, which never matches `C++`. An underscore is not a
    letter, so emphasis like `_Borges_` does not hide the name. `ordered` runs longest first.
    """
    groups = "|".join(f"({re.escape(name)})" for name in ordered)
    return re.compile(rf"(?<![^\W_])(?:{groups})(?![^\W_])", re.IGNORECASE)


BARE_URL = re.compile(r"https?://\S+")
"""An address written out with no link around it, which a `[[link]]` inside would break."""


def skipped(text: str) -> list[tuple[int, int]]:
    """Where a name is not a mention: the block, code, links, tags and bare addresses.

    The tags are the ones `todos.tags_in` reads, so a name inside `#2026-10-13-x`
    is skipped because that is a tag everywhere else too.
    """
    spans = [(0, body_start(text)), *code_spans(text), *tags_in(text)]
    for pattern in (WIKILINK, MARKDOWN_LINK, BARE_URL):
        spans += [match.span() for match in pattern.finditer(text)]
    return spans


def utf16(text: str) -> int:
    """How long `text` is in UTF-16 code units, which is how the browser slices a string."""
    return len(text.encode("utf-16-le")) // 2


def mentions_in(
    path: str, text: str, pattern: re.Pattern[str], ordered: list[str]
) -> list[Mention]:
    """Every mention in one note, in the order the note holds them."""
    spans = skipped(text)
    lines = text.split("\n")
    starts = [0]
    for line in lines:
        starts.append(starts[-1] + len(line) + 1)

    result = []
    for match in pattern.finditer(text):
        # Any overlap, not only a match inside a span: the name in `[[Borges]]`
        # is the bare word, and its edges sit inside the brackets.
        if any(match.start() < end and match.end() > start for start, end in spans):
            continue
        index = bisect_right(starts, match.start()) - 1
        line = lines[index]
        offset = match.start() - starts[index]
        result.append(
            Mention(
                path=path,
                line=index + 1,
                text=line,
                start=utf16(line[:offset]),
                end=utf16(line[: offset + len(match.group())]),
                name=ordered[(match.lastindex or 1) - 1],
            )
        )
    return result


def scan(root: Path, candidates: list[str], found: list[str], cap: int) -> list[Mention]:
    """Every mention in `candidates`, read in path order, up to `cap`."""
    ordered = sorted(found, key=len, reverse=True)
    pattern = matcher(ordered)
    result: list[Mention] = []
    for path in candidates:
        # Read as `GET /api/files` reads it, with `\r\n` as `\n`: the client finds `text` on
        # that line, so offsets into anything else miss.
        try:
            text = read_note(root, path)
        except UnicodeDecodeError:
            # A note that is not UTF-8 is one the client cannot open either, and
            # it should not empty every other note's list.
            continue
        # None when the note went between rg naming it and this reading it.
        if text is None:
            continue
        result += mentions_in(path, text, pattern, ordered)
        if len(result) >= cap:
            return result[:cap]
    return result


async def find_mentions(
    root: Path, path: str, content: str, skip: str | None = None
) -> list[Mention]:
    """Every unlinked mention of the note at `path`, whose text is `content`, up to `MOST_MENTIONS`.

    `path` is the note's canonical spelling, which is what keeps the note out
    of its own list.
    """
    found = names(path, content)
    candidates = sorted(set(await notes_holding(root, *found, skip=skip)) - {path})
    # Reading and matching a few hundred notes in Python would hold the event
    # loop for the whole of it, where rg above held it for none.
    return await asyncio.to_thread(scan, root, candidates, found, MOST_MENTIONS)
