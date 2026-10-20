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
"""Where a CommonMark fence opens a line: past any quote and list markers, each up to three
spaces in, then up to three spaces, then three backticks or tildes.

The markers' run is possessive: a space after `>` could also be the next
marker's indent, and trying every split of a long run that ends in no fence
takes exponential time.
"""


def as_note(deck: Deck) -> str:
    """`deck` as one markdown note: the tag line, a blank line, then a line per card.

    A card with no front is left out, since there is nothing to ask. A card with
    no back is kept as `front::`, which kasten reads as a question parked
    without an answer: a back that adds nothing beyond the front is common in
    Anki, and dropping the line would lose the question with it.

    A front holding `::` is the exception to the one line, and so is a side
    running over lines (#234). A card line splits at its first `::`, so
    `std::move` would cut the question short; such a card is written as front,
    `?` and back, each side keeping its lines, with a blank line either side so
    the `?` card's front and back do not run into the lines next to it. Each
    `::` of the front outside code is written `:&#58;`, which `colons` in
    `card-line.ts` shows as `::`, since `srs.ts` ends a front at a line that
    reads as a card of one line (#683); the back keeps its `::`. It is
    left out where a side cannot stand in that form: an empty back, since
    `srs.ts` asks no `?` with nothing under it and `review.ts` would count one;
    a line of `?`, which `review.ts` counts as a second card; and a line
    `srs.ts` ends a card on, a heading, a line of tags, the parking token or,
    on the back only, a schedule comment, which drops the `?` card there and
    leaves its lines as prose. `note_cards` holds these
    rules. `plain` escapes every such line, so only a card built by hand meets
    them. A front over lines with no back and no `::` is the one-line form
    that parks a question, its breaks spaces.

    Two sides are written other than as they read, so that they read back as
    Anki showed them (#243): a front ending in `:` gets a space before the
    divider, and a side opening a line with a fence, three backticks or three
    tildes, gets a backslash (#674), also where a list or quote marker comes
    first (#679).

    A cloze note holding a mark is a cloze, its marks being what tell kasten
    so, and is never left out. With a Back Extra that can stand as a `?` back,
    over as many lines as it holds, it takes the `?` form; with none, or one
    that cannot, it is its line alone and the extra is lost, which is less than
    losing the card. A cloze note with no mark is a card like any other.

    Every card ends in `<!--anki:NID:ORD-->`, its Anki note and template, after
    its last line, which is how `merge` finds it when the deck comes again. A
    card holding `reviews` takes their schedules as a rating would write them.
    """
    # A tag ends at the first character that is not a letter, a number, `_`,
    # `-` or `/` (`docs/reference/tag-format.md`), so a deck called
    # "JLPT: N5" would otherwise land in a deck called `JLPT` with the rest of
    # its name read as prose. Each run of those becomes one `-`; a `/` stays,
    # being how a nested deck is named. The note's `# heading` is not the deck
    # name; the tag is.
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

    The one place a card is rendered, since a re-import tells a card Anki
    changed from one it did not by comparing these with what the note holds.
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
        # `srs.ts` ends a front at a line it reads as a card of one line
        # (#683), so a front's `::` would cut the question there. A cloze
        # front keeps its marks' `::`: it is one line, taken as the cloze.
        fronts = [undivided(line) for line in fronts]
    return [*map(_unfenced, fronts), "?", *map(_unfenced, backs)]


def written(card: Card, suspended: bool = False, comments: list[str] | None = None) -> list[str]:
    """The lines `as_note` writes for `card`, its marker and state included.

    `comments` replaces the schedules `card`'s reviews would make, and an empty
    list writes none, so `merge` can carry a card's own schedules over as they are.
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

    It is what tells `merge` where the card starts, and whether its lines are
    still the ones the import wrote or ones edited since in kasten.
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

    A front over lines with no back is, its breaks spaces, since a `?` with
    nothing under it is no card.
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

    The client finds code with the editor's markdown parser, which reads any line
    opening with three backticks or three tildes, up to three spaces in, as a
    fence, and both readers skip every card inside one (#674). A fence opening a
    list item or a quote, `- ~~~` or `> ~~~`, is one too (#679). The backslash is
    markdown's own escape, so the side still shows its characters; it goes
    before the first of them, the markers and spaces staying where they were.
    `-~~~` is no list item, a marker wanting a space after it, so it stays.
    """
    found = fence(side)
    return side if found is None else f"{side[:found]}\\{side[found:]}"


def _carried(card: Card) -> list[str]:
    """The schedule comments `card`'s Anki reviews make, as `comment` in `srs.ts` writes them.

    A cloze takes one per number it has a review of, Anki's ord being the
    number less one; any other card has one row and so one review at most.
    """
    if _clozed(card):
        return [
            f"<!--SR:c{r.ord + 1}!{r.due.isoformat()},{r.interval},{r.ease}-->"
            for r in card.reviews
        ]
    return [f"<!--SR:!{r.due.isoformat()},{r.interval},{r.ease}-->" for r in card.reviews[:1]]


def _with_state(lines: list[str], suspended: bool, comments: list[str]) -> list[str]:
    """A marked card's `lines` with the token and the schedules where a rating puts them.

    After the marker on a card of one line, and on a line of their own under a
    `?` card, the token first, as `setSuspended` in `srs.ts` writes them.
    """
    state = " ".join(["!suspended"] * suspended + comments)
    if not state:
        return lines
    if len(lines) == 1:
        return [f"{lines[0]} {state}"]
    return [*lines, state]
