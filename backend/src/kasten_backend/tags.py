"""Every tag written in the vault, for the completion that offers one and for the graph.

Two rg passes: one matches each tag-like span, the other names the notes that need a
whole-note read (a fence, a multi-line comment, indented code, a frontmatter tag). Both
feed the readers the board uses, so no tag is offered that the editor would not read.
"""

import asyncio
from typing import TYPE_CHECKING

from kasten_backend import frontmatter, todo_fields, todos
from kasten_backend.search import scan_vault
from kasten_backend.vault import read_note

if TYPE_CHECKING:
    from pathlib import Path

MOST_TAGS = 100_000
"""How many tags are read at most. A backstop against a generated file, like `MOST_CARDS`.

Not a limit on how many tags a person may own.
"""

MOST_MATCHES = 2_000_000
"""How many spans and could-be tags the line pass reads at most.

Far above `MOST_TAGS`, since most matches are links and code. A cap near `MOST_TAGS`
would stop rg part way through a parallel walk, so which notes lost their tags would vary.
"""


def _read(root: Path, paths: list[str]) -> dict[str, set[str]]:
    """The tags of each note in `paths`, read in path order, up to `MOST_TAGS` in all."""
    tagged: dict[str, set[str]] = {}
    count = 0
    for path in sorted(paths):
        try:
            text = read_note(root, path)
        except UnicodeDecodeError, OSError:
            # A note the client cannot open, or that rg named and then lost, must not empty
            # the other notes' tags.
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

A superset of the rule, which `todos.word_tags` narrows on each match. rg has no
lookbehind, so the character before a hash is consumed. A span is consumed whole, so no
hash inside one matches alone.
"""

_LINE_PASS = rf"{todos.COMMENT_OPENING}|({_SPAN_OR_TAG})"
"""`_SPAN_OR_TAG`, and first a comment opening the line, which takes the line.

rg's `^` matches only a line's start, and `--replace '${1}'` prints the comment as
nothing, so no hash on that line is a tag. Any other match goes to `todos.word_tags`.
"""

FENCE = r"```|~~~"
"""Three backticks or tildes anywhere on a line: a superset of a fence opening.

Unanchored, so a fence in a list item or a blockquote is caught too. A wrong guess costs
one whole-note read, not a wrong tag.
"""

BLOCK = (
    r"\A---[ \t]*\r?\n"
    r"(?:(?:[^-\n]|-[^-\n]|--[^-\n])[^\n]*\n|-{0,2}\r?\n)*?"
    r"(?:[^\n]*#|tags[ \t]*:)"
)
"""A frontmatter holding a hash or a `tags` field before its closing fence.

A closing line that merely starts with three dashes also matches, which only costs a
whole-note read. A block with no hash carries no tag the line pass could take, so most
notes, with an id and two dates, stay on the line pass.
"""

OPEN_COMMENT = r"<!--(?:[^-\n]|-[^-\n]|--+[^->\n])*-*$"
"""A comment still open at the end of its line.

One closed on its line the line pass masks; one opening a line takes the whole line.
"""

ORDERED_COMMENT = r"^[ \t>]*[0-9]{1,9}[.)][ \t]+<!--"
"""An ordered marker before a comment, which opens an HTML block only in a list (#1453).

Under a paragraph a number past 1 starts no list, so the line goes on with the paragraph.
A superset: a `1.` or a list going on costs one whole-note read, not a wrong tag.
"""

MARKS = rf"{BLOCK}|{FENCE}|{OPEN_COMMENT}|{ORDERED_COMMENT}|^(?: {{4}}|\t)[^\n]*#"
"""What says a note's lines cannot be read one at a time.

Only the whole note says where a block, fence or comment starts and ends. The match is
replaced by one character, not none: rg 14 prints no line for a match of this pattern
replaced by none, where it prints one for a fence alone.
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


async def tags_by_note(root: Path, skip: str | None = None) -> dict[str, set[str]]:
    """The tags of every note under `root` outside the `skip` folder that holds one."""
    # Only matches come back, so a line past a stream reader's 64 KiB limit cannot stop a scan.
    # The second scan answers one line per note, since each hit costs Python time.
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

    The archive is walked too, unlike other scans here: a tag is a spelling you reuse, and
    the note that taught it does not unteach it when archived.
    """
    return sorted(set().union(*(await tags_by_note(root)).values()))
