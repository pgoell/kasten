"""The cards and decks an export reads to, which every module that makes or merges a card names.

A card keeps the note and template it was rendered from, so the note writer and
the re-import can work from the card alone, without the export it came from.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import date


@dataclass(frozen=True)
class Template:
    """One card template of a note type: its front and its back."""

    name: str
    qfmt: str
    afmt: str


@dataclass(frozen=True)
class Review:
    """One card row Anki has in review, as much of it as a schedule comment holds."""

    ord: int
    due: date
    interval: int
    ease: int
    """Anki's `factor` in percent, which is what the comment holds: 2500 is 250."""


@dataclass(frozen=True)
class Card:
    """One Anki card as two sides of markdown, with what it was rendered from kept beside it."""

    front: str
    back: str
    fields: dict[str, str]
    template: Template
    notetype: str
    cloze: bool
    nid: int
    """The Anki note the card came from, which a second import finds it by."""
    ord: int
    """Its template's ord, a cloze's lowest, since its numbers share a line."""
    reviews: tuple[Review, ...] = ()
    """Its rows in review, every number's for a cloze; read only when the import carries them."""


@dataclass(frozen=True)
class Deck:
    """One Anki deck, as much of it as a markdown note can hold."""

    name: str
    cards: list[Card]
    media: dict[str, bytes]
    """Every file a card links, by its name in the deck's media folder."""
