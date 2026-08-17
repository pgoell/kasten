"""Finding every line the vault holds that could be part of a flashcard.

One rg pass over the notes, the same way `todos.py` reads them and for the same
reason: the files are the source of truth, so nothing here is indexed and
nothing here can go stale.

The backend does not parse a card. It finds the candidate lines and hands them
over whole, because the browser has to parse the format anyway to draw a card
and two parsers in two languages drift. That division is what lets one endpoint
answer both halves of the feature: a deck of cards and a whole note marked for
review are different things to `srs.ts` and the same five patterns here.
"""

from typing import TYPE_CHECKING

from kasten_backend.search import scan_vault

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.search import Hit

MOST_CARDS = 100_000
"""How many matching lines come back at most.

The number `MOST_TODOS` is, for the reason it is that number: a backstop against
one generated file with a million `::` in it, not a limit on how many cards a
person is willing to own. An imported Anki deck is a real four-figure case, so a
cap set where reading stops being pleasant would be reached by a deck somebody
actually has.
"""

CARD_LINE = r"::|^[ \t]*\?[ \t]*$"
"""A card written on one line, or the `?` dividing one written over several.

`::` is deliberately loose. It matches `std::vector` and a YAML flow mapping too,
and the note's deck tag is what keeps those out of the queue rather than a
cleverer pattern here: a note nobody tagged holds no cards whatever is in it, so
the false positives cost a line in the answer and never a card on screen.
"""

SCHEDULE_LINE = r"<!--SR:!"
"""The comment holding a card's schedule, wherever it sits.

On the end of a one-line card, so the same line matches `CARD_LINE` as well and
rg reports it once, or on a line of its own under a longer card's back. That is
what makes the count work out: every card matches exactly once through
`CARD_LINE`, and every schedule exactly once through this.
"""

FENCE_LINE = r"^[ \t]*```"
"""A fenced code block's marker, handed over so the client can find the block.

A fence line is a card in no reading of the format: it holds no `::`, no `?` and
no tag, so nothing counted it before and nothing counts it now. It comes back
because the reader on the other side has no other way to tell a card from a
`std::vector`, the lines inside a block matching nothing that would reach it.
"""

NOTE_LINE = r"#flashcards|#review|^sr-due:"
"""What marks a note as a deck, and the due date of a note that is itself the card.

`#flashcards` and `#flashcards/aws` are both matched by the first branch, the
deck name being the client's to read off the tag. `sr-due` is anchored because
it is a frontmatter field, and an unanchored one would match the word in prose.
"""

CARD_PATTERN = f"{CARD_LINE}|{SCHEDULE_LINE}|{FENCE_LINE}|{NOTE_LINE}"


async def find_cards(root: Path, skip: str | None = None) -> list[Hit]:
    """Every line under `root` that could be part of a card, up to `MOST_CARDS`.

    `skip` names a folder to walk past, which is how a deck moved into the
    archive leaves the review queue. That is the whole of archiving here: no
    field, no flag and no key of its own, because a deck you are finished with
    is a note you are finished with.
    """
    # `-e` so the pattern, which opens with a caret and holds a dash, is a
    # pattern and not a flag.
    return await scan_vault(root, ("-e", CARD_PATTERN), MOST_CARDS, skip)
