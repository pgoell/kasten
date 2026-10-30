"""The markdown note a deck is written as, a line or `?` card at a time, each with its marker.

`as_note` is the entry, and `note_cards` says which cards it writes. `card_lines` is
the one place a card's shape is decided, since `merge` compares the lines a
note holds with what `card_lines` would write now.
"""

import hashlib
import re
from typing import TYPE_CHECKING

from kasten_backend.anki_html import ends_card, marks, reads_mark, undivided

if TYPE_CHECKING:
    from kasten_backend.anki_deck import Card, Deck

_SCHEDULE = re.compile(r"<!--SR:!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->")
"""`SR` in `card-line.ts`, the whole comment: `srs.ts` stops a back at nothing less."""
_FENCE = re.compile(r"(?: {0,3}(?:>[ \t]?|(?:[-*+]|[0-9]{1,9}[.)])[ \t]))*+ {0,3}(?=```|~~~)")
"""Where a CommonMark fence opens a line: past quote and list markers, then backticks or tildes.

The marker run is possessive: a space after `>` could also be the next marker's indent, and
splitting a long run that ends in no fence takes exponential time.
"""


def as_note(deck: Deck) -> str:
    """`deck` as one markdown note: the tag line, a blank line, then a line per card.

    A card with no front is left out. One with no back stays as `front::`, so its question survives.
    A front with `::`, or a side over lines, becomes a `?` card with blank lines around it.
    Each card ends in `<!--anki:NID:ORD-->`, which is how `merge` finds it again.
    """
    # A tag ends at the first character outside letters, digits, `_`, `-` and `/`, so a deck
    # named "JLPT: N5" needs each run of others turned into one `-`. The `/` stays for nesting.
    head = [f"#flashcards/{re.sub(r'[^\w/-]+', '-', deck.name)}", ""]
    body: list[str] = []
    for card in note_cards(deck):
        place(body, written(card))
    # The blank a `?` card leaves under itself is a separator, not part of the
    # note, so the last one comes off rather than ending the note on two breaks.
    if body and not body[-1]:
        body.pop()
    return "\n".join(head + body) + "\n"


def note_cards(deck: Deck) -> list[Card]:
    """The cards of `deck` that `as_note` writes, in order, by the rules its docstring gives.

    Its own function so the import's count and the note agree on which they are.
    """
    return [
        card
        for card in deck.cards
        if card.front and (_clozed(card) or _one_line(card) or _divides(card))
    ]


def card_count(deck: Deck) -> int:
    """How many cards the note `as_note` writes holds: a cloze is one per number it marks."""
    return sum(_numbers(card.front) if _clozed(card) else 1 for card in note_cards(deck))


def card_lines(card: Card) -> list[str]:
    """The lines `as_note` writes for `card`, unmarked: one, or the three parts of a `?` card.

    `merge` compares these with the note, which is how it tells an Anki change from none.
    """
    if _clozed(card) and not _divides(card):
        # A cloze line holds no divider, so the colon gap has nothing to keep.
        return [_unfenced(card.front)]
    if _one_line(card):
        front = _unfenced(card.front.replace("\n", " "))
        # `divide` splits at the first `::`, so `Ratio 1:` before the divider
        # would lose its colon to the back; it trims the space this adds.
        gap = " " if front.endswith(":") else ""
        return [f"{front}{gap}::{card.back}"]
    fronts, backs = card.front.splitlines(), card.back.splitlines()
    if not _clozed(card):
        # `srs.ts` ends a front at a line that reads as a card (#683), so its `::` would cut
        # the question short. A cloze front keeps its marks' `::`: it is one line.
        fronts = [undivided(line) for line in fronts]
    return [*map(_unfenced, fronts), "?", *map(_unfenced, backs)]


def written(card: Card, suspended: bool = False, comments: list[str] | None = None) -> list[str]:
    """The lines `as_note` writes for `card`, its marker and state included.

    `comments` replaces the schedules `card`'s reviews would make. `[]` writes none.
    """
    return _with_state(
        _marked(card, card_lines(card)),
        suspended,
        _carried(card) if comments is None else comments,
    )


def _marked(card: Card, lines: list[str]) -> list[str]:
    """`lines` with the card's marker after the last, where no rating writes."""
    return [*lines[:-1], f"{lines[-1]} <!--anki:{card.nid}:{card.ord}:{digest(lines)}-->"]


def digest(lines: list[str]) -> str:
    """The hash a marker holds of the unmarked `lines` it ends.

    `merge` finds a card's start with it, and sees whether the lines were edited since.
    """
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()[:8]


def place(body: list[str], lines: list[str]) -> None:
    """`lines` added to `body`, a `?` card with a blank line either side of it.

    So the `?` card's front and back do not run into the lines next to it.
    """
    if len(lines) == 1:
        body.append(lines[0])
        return
    if body and body[-1]:
        body.append("")
    body += [*lines, ""]


def _one_line(card: Card) -> bool:
    """Whether `card` is written as `front::back`: no `::` to split it, and no side over lines.

    A front over lines with no back is one line too, its breaks becoming spaces.
    """
    return "::" not in card.front and (not card.back or "\n" not in card.front + card.back)


def _numbers(text: str) -> int:
    """How many numbers `text` marks, nested marks among them."""
    # As numbers, since `c01` and `c1` are one card to Anki.
    numbers: set[int] = set()

    def take(match: re.Match[str]) -> str:
        numbers.add(int(match[1]))
        return "_"

    marks(text, take)
    return len(numbers)


def _clozed(card: Card) -> bool:
    """Whether `card` is written as a cloze: a cloze note's text holding a mark kasten reads."""
    return card.cloze and reads_mark(card.front)


def _divides(card: Card) -> bool:
    """Whether `card` can stand as front, `?` and back, by `as_note`'s rules, line by line.

    A back holding a marker cannot, since `merge` would read the card as ending there.
    """
    lines = [*card.front.splitlines(), *card.back.splitlines()]
    return bool(card.back) and not (
        any(ends_card(line) or line == "?" for line in lines)
        or _SCHEDULE.search(card.back)
        or "<!--anki:" in card.back
    )


def fence(line: str) -> int | None:
    """Where the fence `line` opens starts, past any quote and list markers, or None if none."""
    found = _FENCE.match(line)
    return None if found is None else found.end()


def _unfenced(side: str) -> str:
    """`side` with a leading fence escaped, so it opens no code block in the note.

    Both readers skip every card inside a fence (#674), and a fence after a list or quote
    marker counts too (#679). The backslash is markdown's own escape, placed before the fence.
    """
    found = fence(side)
    return side if found is None else f"{side[:found]}\\{side[found:]}"


def _carried(card: Card) -> list[str]:
    """The schedule comments `card`'s reviews make, as `comment` in `srs.ts` writes them.

    A cloze takes one per number, Anki's ord being the number less one.
    Any other card has one at most.
    """
    if _clozed(card):
        return [
            f"<!--SR:c{r.ord + 1}!{r.due.isoformat()},{r.interval},{r.ease}-->"
            for r in card.reviews
        ]
    return [f"<!--SR:!{r.due.isoformat()},{r.interval},{r.ease}-->" for r in card.reviews[:1]]


def _with_state(lines: list[str], suspended: bool, comments: list[str]) -> list[str]:
    """A marked card's `lines` with the token and the schedules where a rating puts them.

    On the marker's line for a card of one line, else on a line of its own under the `?` card.
    """
    state = " ".join(["!suspended"] * suspended + comments)
    if not state:
        return lines
    if len(lines) == 1:
        return [f"{lines[0]} {state}"]
    return [*lines, state]
