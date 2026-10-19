"""Every tag written anywhere in the vault, for the completion that offers one.

One rg pass over the notes, the way `cards.py` and `todos.py` read them and for
the same reason: the notes are the source of truth, so nothing here is indexed
and nothing here can go stale.

Only the matches come back rather than the lines holding them. A tag is a word
and not a place, so what the editor needs is the vocabulary, and the note it was
written in is no part of the answer. A whole line would also do harm: a pasted
inline SVG is one line past the 64 KiB a stream reader takes.

A hash in a code span or a link is no tag in the editor, nor in `todos.py`, so
completion offering it would teach a spelling nothing else reads as a tag. rg
matches every span as well as every tag, a span first, and a span is consumed
whole, so no hash inside one comes back on its own. Each match is then read as
`todos.py` reads a line: `todos.TAG` on the match with its spans masked.
"""

from typing import TYPE_CHECKING

from kasten_backend import todos
from kasten_backend.search import scan_vault

if TYPE_CHECKING:
    from pathlib import Path

MOST_TAGS = 100_000
"""How many matches come back at most, spans among them, before they are read.

Matches and not tags: a vault holding a hundred notes about one thing hits this
with a vocabulary of ten words. It is a backstop against a generated file, the
way `MOST_CARDS` is, and not a limit on how many tags a person may own.
"""

_WORD = r"#[\p{L}_][\p{L}\p{N}_/-]*"
TAG = r"(?:^|[^\p{L}\p{N}_/])" + _WORD
"""`#tag`, spelled the way `tag.ts` spells it so the two agree on what one is.

The leading branch is what keeps `note#2` out, and it is a consumed character
rather than a lookbehind because rg's engine has none. Anchoring on `#` alone
would be looser than the parser that colours a tag, and offering a completion
the editor would not then draw as a tag is worse than offering nothing.
"""

_SPAN_OR_TAG = f"(?:{todos.SPANS.pattern})(?:{_WORD})?|{TAG}"
"""A span or a tag, the span tried first at each place, as rg alternates leftmost-first.

The span reuses `todos.SPANS` itself, so this reads no third kind of span. A
tag straight after a span rides along with it: the span takes the character
`TAG` would have to consume in front of the hash, and `todos.TAG` sees the
masked span there, which is no word, so `` `s`#x `` reads `#x` as `todos.py`
reads it.
"""


async def find_tags(root: Path) -> list[str]:
    """Every tag under `root`, once each, sorted.

    The archive is walked too, unlike every other scan here. What is filed away
    is out of a search because it is not what is being looked for; a tag is a
    word you are trying to spell the same way you spelled it last time, and the
    note that taught you the spelling being archived does not unteach it.
    """
    hits = await scan_vault(root, ("--only-matching", "-e", _SPAN_OR_TAG), MOST_TAGS)
    # A match opening with the character in front of the tag still holds the
    # tag, as `todos.TAG`'s lookbehind wants it, and a span holds none once
    # masked. Found on the mask and read off the match, the mask keeping offsets.
    return sorted(
        {
            hit.text[found.start() : found.end()]
            for hit in hits
            for found in todos.TAG.finditer(todos.mask(hit.text))
        }
    )
