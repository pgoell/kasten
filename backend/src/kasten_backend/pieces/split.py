"""The pieces a note is cut into for the semantic index, each embedded and BM25-indexed alone.

A note is read by its headings first, so a piece knows the part of the note it
came from. A long section is then cut into windows of tokens that overlap a
little, so a sentence on a window's edge is whole in one of them. Each piece
carries its note's title and heading path in front, because a chunk on its own
("Kosten 120 EUR") says nothing about what it is about.

Headings come from markdown-it, not a regex: a `#` line inside a fenced code
block is code, and a regex would cut the section there.
"""

from collections.abc import Callable
from dataclasses import dataclass

from markdown_it import MarkdownIt

from kasten_backend.frontmatter import body_start

Offsets = Callable[[str], list[tuple[int, int]]]
"""Character spans (start, end) of each token in a text, in order."""

_MARKDOWN = MarkdownIt("commonmark")
"""Built once, since building a parser costs more than reading a heading."""


@dataclass(frozen=True, slots=True)
class Piece:
    """One chunk of a note, as the index stores it."""

    heading: str  # the heading path, headings joined by " > ", "" before the first heading
    text: str  # what is embedded and BM25-indexed: prefix line, blank line, the chunk


def title_of(path: str) -> str:
    """The note's file name without `.md`: `a/b/Steuer 2025.md` is `Steuer 2025`."""
    return path.rsplit("/", 1)[-1].removesuffix(".md")


def split_note(
    path: str, content: str, offsets: Offsets, size: int = 512, overlap: int = 64
) -> list[Piece]:
    """The pieces of one note, in reading order, each with the note's title in front.

    The body only: frontmatter never reaches the index. `size` and `overlap` count
    the tokens `offsets` finds. The same content gives the same pieces, so an index
    rebuilt from the vault has the same rows.
    """
    title = title_of(path)
    pieces = []
    for heading, section in _sections(content[body_start(content) :]):
        prefix = f"{title} > {heading}" if heading else title
        for chunk in _chunks(section, offsets, size, overlap):
            pieces.append(Piece(heading, f"{prefix}\n\n{chunk}"))
    return pieces


def _sections(body: str) -> list[tuple[str, str]]:
    """The body's sections as (heading path, text), the text before the first heading first.

    A section runs from the line after its heading to the line before the next
    heading, whatever the level. The path is a stack: a heading drops every
    heading at its level or deeper, so `### C` under `## B` reads `A > B > C`,
    and the `## D` after it reads `A > D`.
    """
    # Carriage returns become spaces so the parser's line numbers match the split
    # on "\n" below, the same trick code_spans uses.
    tokens = _MARKDOWN.parse(body.replace("\r", " "))
    lines = body.split("\n")
    sections = []
    stack: list[tuple[int, str]] = []
    path = ""
    start = 0
    for index, token in enumerate(tokens):
        if token.type != "heading_open" or token.map is None:
            continue
        first, stop = token.map
        sections.append((path, "\n".join(lines[start:first])))
        level = int(token.tag[1])
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, tokens[index + 1].content))
        path = " > ".join(text for _, text in stack)
        start = stop
    sections.append((path, "\n".join(lines[start:])))
    return sections


def _chunks(text: str, offsets: Offsets, size: int, overlap: int) -> list[str]:
    """The chunks of one section: the whole text when it fits, else windows of `size` tokens.

    Windows step by `size - overlap`, so neighbours share exactly `overlap` tokens.
    The window that reaches the last token is the last one.
    """
    if not text.strip():
        return []
    tokens = offsets(text)
    if len(tokens) <= size:
        return [text.strip()]
    chunks = []
    for start in range(0, len(tokens), size - overlap):
        end = min(start + size, len(tokens))
        chunks.append(text[tokens[start][0] : tokens[end - 1][1]])
        if end == len(tokens):
            break
    return chunks
