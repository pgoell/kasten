"""Every tag written in the vault, for the completion that offers one and for the graph.

Two rg passes. One matches every span and every hash that could open a tag, and
each match is read by `todos.word_tags`, as the board reads a todo's words. The
other names the notes that may hold a fence, a comment over several lines,
indented code, or a frontmatter with a hash or a `tags` field in it. Those are
read whole by `todos.tags_in` instead, because only a whole note says where a
block opens and closes, and the line pass reads one line at a time. Most notes
carry a frontmatter of an id and dates and none of the rest, so they stay on
the line pass. Either way the reader is the one the
board, the graph and the mentions use, so completion offers no tag the editor
would not read as one. The notes are the source of truth, so nothing here is
indexed and nothing here can go stale.
"""

import asyncio
from typing import TYPE_CHECKING

from kasten_backend import frontmatter, todo_fields, todos
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
        fields = field_tags(text)
        tagged[path] = {text[start:end] for start, end in found} | fields
        count += len(found) + len(fields)
        if count >= MOST_TAGS:
            break
    return tagged


_RUN = r"#[\p{L}\p{N}_/-]+"
_SPAN_OR_TAG = rf"(?:{todo_fields.SPANS.pattern})(?:{_RUN})?|(?:^|[^\p{{L}}\p{{N}}_/]){_RUN}"
"""A span or what could be a tag, the span tried first at each place, as rg alternates.

A superset of the rule, numbers alone included, which `todos.word_tags` then
narrows on each match. The character in front of the hash is consumed rather
than looked behind, because rg's engine has no lookbehind. A span is consumed
whole, so no hash inside one comes back on its own, and a tag straight after a
span rides along with it, the span masked to no word in front of the hash.
"""

_LINE_PASS = rf"{todos.COMMENT_OPENING}|({_SPAN_OR_TAG})"
"""`_SPAN_OR_TAG`, and first a comment opening the line, which takes the line.

rg's `^` is a line's start, so the first alternative matches only there, and
`--replace '${1}'` prints it as nothing: no hash on that line is a tag. Each
other match comes back whole, and `todos.word_tags` reads it as the words it
is, since a match starting `<!--` in the middle of a line, its tag riding
along, opens no block.
"""

FENCE = r"```|~~~"
"""Three backticks or tildes anywhere on a line: a superset of a fence opening.

A note holding one is read whole instead, since only the whole note says where
the fence ends. Unanchored, so a fence in a list item or a blockquote is caught
too, and the cost of a wrong guess is one note read rather than a wrong tag.
"""

BLOCK = (
    r"\A---[ \t]*\r?\n"
    r"(?:(?:[^-\n]|-[^-\n]|--[^-\n])[^\n]*\n|-{0,2}\r?\n)*?"
    r"(?:[^\n]*#|tags[ \t]*:)"
)
"""A frontmatter holding a hash or a `tags` field before its closing fence.

Line 1 opens it and the first line of three dashes closes it, as
`frontmatter.py` reads the block; a line merely starting with them closes it
here too, which only costs a note read whole. One that never closes matches
as well, and the reading whole then finds no block. A block with no hash in
it carries nothing the line pass could take for a tag, so most notes, whose
block holds an id and two dates, stay on the line pass.
"""

OPEN_COMMENT = r"<!--(?:[^-\n]|-[^-\n]|--+[^->\n])*-*$"
"""A comment still open at the end of its line.

One closed on its line the line pass masks, and it skips the whole line of
one that opens the line, as `_LINE_PASS` says.
"""

MARKS = rf"{BLOCK}|{FENCE}|{OPEN_COMMENT}|^(?: {{4}}|\t)[^\n]*#"
"""What says a note's lines cannot be read one at a time.

A frontmatter with a hash or a tags field in it, a fence, a comment over
several lines, and a hash as far in as code is: only the whole note says where
each of those starts and ends. Matched over the whole note, since the block is
several lines, and replaced by one character, so a long line comes back short.
Not by none: rg 14 then prints no line for a match of this pattern, where it
prints one for a fence alone.
"""


def field_tags(text: str) -> set[str]:
    """The tags the frontmatter's `tags` field names, each with its hash, by the tag rule.

    Obsidian reads a tag in the block from that field alone, written with a hash
    or without, so `tags: [a, b/c]` carries `#a` and `#b/c`, and `tags: [1984]`
    none, as `#1984` would carry none in the text.
    """
    found = set()
    for value in frontmatter.tags(text):
        tag = value if value.startswith("#") else f"#{value}"
        if todos.TAG.fullmatch(tag):
            found.add(tag)
    return found


async def tags_by_note(root: Path, skip: str | None = None) -> dict[str, set[str]]:
    """The tags of every note under `root` outside the `skip` folder that holds one."""
    # Only the matches come back, so a line past the 64 KiB a stream reader
    # takes, a pasted inline SVG, cannot stop either scan. The second answers
    # one line per note to read, rather than a line per fence: a hit is most of
    # what a scan costs in Python.
    matches, marks = await asyncio.gather(
        scan_vault(
            root,
            ("--only-matching", "--replace", "${1}", "-e", _LINE_PASS),
            MOST_MATCHES,
            skip,
        ),
        scan_vault(
            root,
            ("--multiline", "--only-matching", "--replace", "#", "--max-count", "1", "-e", MARKS),
            MOST_MATCHES,
            skip,
        ),
    )
    whole = {hit.path for hit in marks}
    tagged: dict[str, set[str]] = {}
    for hit in matches:
        if hit.path not in whole:
            found = {hit.text[start:end] for start, end in todos.word_tags(hit.text)}
            tagged.setdefault(hit.path, set()).update(found)
    # Reading those notes in Python would hold the event loop for the whole
    # of it, where rg above held it for none.
    tagged.update(await asyncio.to_thread(_read, root, sorted(whole)))
    return tagged


async def find_tags(root: Path) -> list[str]:
    """Every tag under `root`, once each, sorted.

    The archive is walked too, unlike every other scan here. What is filed away
    is out of a search because it is not what is being looked for; a tag is a
    word you are trying to spell the same way you spelled it last time, and the
    note that taught you the spelling being archived does not unteach it.
    """
    return sorted(set().union(*(await tags_by_note(root)).values()))
