"""Finding the vault lines that could be part of a flashcard.

One rg pass, as `todos.py` does. The backend hands over candidate lines whole and the
browser parses the card format, since two parsers would drift. Code is not skipped:
the client asks the editor's markdown parser where code blocks are.
"""

from typing import TYPE_CHECKING

from kasten_backend.search import scan_vault

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.search import Hit

MOST_CARDS = 100_000
"""How many matching lines come back at most: a backstop, not a card limit.

A generated file can hold a million `::`. A real imported Anki deck can reach four
figures, so the cap sits far above that.
"""

CARD_LINE = r"::|^[ \t]*\?[ \t]*$"
"""A card on one line, or the `?` dividing one written over several.

`::` is deliberately loose, matching `std::vector` too. The deck tag keeps those out
of the queue, not a cleverer pattern.
"""

SCHEDULE_LINE = r"<!--SR:(?:c\d+)?!"
"""The comment holding a card's schedule, or a cloze number's.

On a one-line card it shares a line with `CARD_LINE`. rg reports a line once, so the
count still matches the cards.
"""

PARKED_LINE = r"^[ \t]*!suspended"
"""The token parking a card written over several lines.

Anchored, since `the account was !suspended for a week` is a sentence. A one-line card
needs no branch: its token sits after the `::`.
"""

NOTE_LINE = r"#flashcards|#review|^sr-due:|^sr-suspended:"
"""What marks a note as a deck, and the two fields of a note that is itself a card.

`sr-due` and `sr-suspended` are anchored, since unanchored they would match words in prose.
"""

CARD_PATTERN = f"{CARD_LINE}|{SCHEDULE_LINE}|{PARKED_LINE}|{NOTE_LINE}"


async def find_cards(root: Path, skip: str | None = None) -> list[Hit]:
    """Every line under `root` that could be part of a card, up to `MOST_CARDS`.

    `skip` names a folder to walk past, so a deck moved into the archive leaves the queue.
    Archiving needs no field of its own.
    """
    # `-e` so the pattern, which opens with a caret and holds a dash, is a
    # pattern and not a flag.
    return await scan_vault(root, ("-e", CARD_PATTERN), MOST_CARDS, skip)
