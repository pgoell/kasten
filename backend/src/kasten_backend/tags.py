"""Every tag written anywhere in the vault, for the completion that offers one.

One rg pass over the notes, the way `cards.py` and `todos.py` read them and for
the same reason: the notes are the source of truth, so nothing here is indexed
and nothing here can go stale.

rg finds the lines that may hold a tag, and each tag is then read off its line
the way `todos.py` reads one: `todos.TAG` on the line with every code span and
link masked. A hash in a span is no tag in the editor, so completion offering
it would teach a spelling nothing else reads as a tag. A tag is a word and not
a place, so only the vocabulary comes back, and the note it was written in is
no part of the answer.
"""

from typing import TYPE_CHECKING

from kasten_backend import todos
from kasten_backend.search import scan_vault

if TYPE_CHECKING:
    from pathlib import Path

MOST_TAGS = 100_000
"""How many lines holding a tag come back at most, before the tags are read off them.

Lines and not tags: a vault holding a hundred notes about one thing hits this
with a vocabulary of ten words. It is a backstop against a generated file, the
way `MOST_CARDS` is, and not a limit on how many tags a person may own.
"""

TAG = r"(?:^|[^\p{L}\p{N}_/])#[\p{L}_][\p{L}\p{N}_/-]*"
"""`#tag`, spelled the way `tag.ts` spells it so the two agree on what one is.

The leading branch is what keeps `note#2` out, and it is a consumed character
rather than a lookbehind because rg's engine has none. Here it only picks the
lines worth reading, the tag itself being read by `todos.TAG`; `graph.py` still
reads its matches.
"""


async def find_tags(root: Path) -> list[str]:
    """Every tag under `root`, once each, sorted.

    The archive is walked too, unlike every other scan here. What is filed away
    is out of a search because it is not what is being looked for; a tag is a
    word you are trying to spell the same way you spelled it last time, and the
    note that taught you the spelling being archived does not unteach it.
    """
    hits = await scan_vault(root, ("-e", TAG), MOST_TAGS)
    # Found on the mask and read off the line, the mask keeping every offset.
    return sorted(
        {
            hit.text[found.start() : found.end()]
            for hit in hits
            for found in todos.TAG.finditer(todos.mask(hit.text))
        }
    )
