"""Every tag written anywhere in the vault, for the completion that offers one.

One rg pass over the notes, the way `cards.py` and `todos.py` read them and for
the same reason: the notes are the source of truth, so nothing here is indexed
and nothing here can go stale.

Only the matches come back rather than the lines holding them. A tag is a word
and not a place, so what the editor needs is the vocabulary, and the note it was
written in is no part of the answer.
"""

from typing import TYPE_CHECKING

from kasten_backend.search import scan_vault

if TYPE_CHECKING:
    from pathlib import Path

MOST_TAGS = 100_000
"""How many matches come back at most, before they are deduplicated.

Matches and not tags: a vault holding a hundred notes about one thing hits this
with a vocabulary of ten words. It is a backstop against a generated file, the
way `MOST_CARDS` is, and not a limit on how many tags a person may own.
"""

TAG = r"(?:^|[^\p{L}\p{N}_/])#[\p{L}_][\p{L}\p{N}_/-]*"
"""`#tag`, spelled the way `tag.ts` spells it so the two agree on what one is.

The leading branch is what keeps `note#2` out, and it is a consumed character
rather than a lookbehind because rg's engine has none. That character is cut off
below. Anchoring on `#` alone would be looser than the parser that colours a
tag, and offering a completion the editor would not then draw as a tag is worse
than offering nothing.
"""


async def find_tags(root: Path) -> list[str]:
    """Every tag under `root`, once each, sorted.

    The archive is walked too, unlike every other scan here. What is filed away
    is out of a search because it is not what is being looked for; a tag is a
    word you are trying to spell the same way you spelled it last time, and the
    note that taught you the spelling being archived does not unteach it.
    """
    hits = await scan_vault(root, ("--only-matching", "-e", TAG), MOST_TAGS)
    # From the last hash: the match may open with the character in front of the
    # tag, and that character can itself be a hash. A tag holds none.
    return sorted({hit.text[hit.text.rindex("#") :] for hit in hits})
