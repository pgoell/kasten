"""Importing a deck again into the note kasten already holds, card by card.

A card is found by the marker `as_note` ends it with. Its lines are rewritten
only when Anki changed them, and a rating or an edit made in kasten is kept, as
the marker's hash and the schedule comments say which it was.
"""

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from kasten_backend.anki_html import ends_card
from kasten_backend.anki_note import card_lines, digest, fence, note_cards, place, written

if TYPE_CHECKING:
    from kasten_backend.anki_deck import Card, Deck

_ANKI_ID = re.compile(r"<!--anki:(\d+):(\d+):([0-9a-f]{8})-->")
"""`ANKI_ID` in `card-line.ts`: the Anki note, template and hash `as_note` writes after a card."""
_SPAN_LIMIT = 200
"""The most lines `_spans` takes a card to run over, so a long note costs this a card at most."""
_STATE = re.compile(r"<!--SR:[^>]*?-->")
"""A schedule comment of either kind, plain or a cloze number's, which a re-import carries over."""
_TOKEN_WORD = re.compile(r"(?:^|\s)!suspended(?=\s|$)")
"""The parking token whole, as `suspended()` in `card-line.ts` reads it."""


@dataclass(frozen=True)
class Merged:
    """A deck's note after a re-import, and what came of its cards, counted a marker each."""

    text: str
    added: int
    updated: int
    kept: int
    removed: int


@dataclass(frozen=True)
class _Span:
    """One marked card of a note: lines `start` to `end`, its hash, and what a rating left on it."""

    start: int
    end: int
    digest: str
    """The hash its marker holds, of the lines the import wrote."""
    found: bool
    """Whether lines ending at the marker still hash to it; not, once edited in kasten."""
    suspended: bool
    comments: list[str]
    inside: bool = False
    """Whether `srs.ts` reads it as part of another card, so it is never rewritten.

    Either a `?` line sits above it with nothing between that ends a back,
    which makes it part of that `?` card's answer (#684); or it is a `?` card
    with no state under its marker and a line under that which no back ends
    at, so `srs.ts` runs its back on and the schedule further down, written
    for the two as one, is read as its own. Either way the schedule belongs
    to a card that is not only this one's, and rewriting it would move that
    schedule or set blank lines through the card.
    """


def merge(old: str, deck: Deck) -> Merged | None:
    """The note `old` with `deck` imported into it again, or None when `old` holds no marker.

    A card is found by its marker. One whose lines `card_lines` would write the
    same now is kept as it stands, and one Anki changed is written anew, the
    parking token and the schedules a rating left on it carried into its new
    shape. One edited in kasten since is kept too, whatever Anki did: the edit
    is the user's, and the marker's hash no longer finding the card says so,
    save the one change `_rated` reads as a rating's and not the user's. A
    card the note lacks goes on the end in `as_note`'s layout. One the export
    lacks stays, since its schedule is history worth more than tidiness, and is
    only counted. Every line without a marker, the tag line and whatever the
    user wrote, comes through byte for byte.

    None for a note without a marker, which an import older than the marker
    wrote: nothing in it says which card is which, so nothing can be merged.

    A note whose first line ends in CRLF, as one saved on Windows may, is read
    without the CRs, so its hashes match, and written back with CRLF on every
    line rather than with two endings in one file.
    """
    crlf = old.split("\n", 1)[0].endswith("\r")
    lines = [line.removesuffix("\r") for line in old.split("\n")]
    spans = _spans(lines)
    if not spans:
        return None

    added: list[list[str]] = []
    replaced: dict[int, tuple[_Span, list[str]]] = {}
    kept = 0
    for card in note_cards(deck):
        span = spans.get((card.nid, card.ord))
        if span is None:
            added.append(written(card))
            continue
        rated = [] if span.found else _rated(lines[span.start], span, card)
        if span.digest == digest(card_lines(card)) or rated is None or span.inside:
            kept += 1
        else:
            comments = span.comments + rated
            replaced[span.start] = (span, written(card, span.suspended, comments))

    out, updated = _replaced(lines, replaced)
    kept += len(replaced) - updated
    if added:
        while out and not out[-1]:
            out.pop()
        # A `?` card or the user's prose would run into a card added right under
        # it, and so would one inside the user's `?` card, as its answer.
        last = len(out) - 1
        if not any(
            s.found and not s.inside and s.start == s.end == last for s in _spans(out).values()
        ):
            out.append("")
        for new in added:
            place(out, new)
        if not out[-1]:
            out.pop()
        out.append("")
    removed = len(spans.keys() - {(card.nid, card.ord) for card in note_cards(deck)})
    # Untouched, the note comes back as it was, whatever its line ends.
    text = ("\r\n" if crlf else "\n").join(out) if added or updated else old
    return Merged(text, len(added), updated, kept, removed)


def marked_cards(text: str) -> set[tuple[int, int]]:
    """The Anki note and template of every card `text` marks, read as `_spans` reads a marker."""
    cards: set[tuple[int, int]] = set()
    for line in text.split("\n"):
        found = _ANKI_ID.search(line)
        if found is not None:
            cards.add((int(found[1]), int(found[2])))
    return cards


def _replaced(
    lines: list[str], replaced: dict[int, tuple[_Span, list[str]]]
) -> tuple[list[str], int]:
    """`lines` with each span in `replaced`, keyed by where it starts, swapped for its new lines.

    Also how many were swapped. A span starting inside one already swapped is
    left as it is: two cards cannot hold one line, and writing the second
    would lose part of the first.
    """
    out: list[str] = []
    at = applied = 0
    while at < len(lines):
        if at not in replaced:
            out.append(lines[at])
            at += 1
            continue
        applied += 1
        span, card_lines = replaced[at]
        block = len(card_lines) > 1
        # A card that turned into a `?` card needs the blank lines either side
        # that `as_note` gives one, or it would run into its neighbours.
        if block and out and out[-1].strip():
            out.append("")
        out += card_lines
        at = span.end + 1
        if block and at < len(lines) and lines[at].strip():
            out.append("")
    return out, applied


def _rated(line: str, span: _Span, card: Card) -> list[str] | None:
    """The schedules a rating wrote inside a line 0.49.2 wrote for `card`, or None.

    0.49.2 wrote a schedule comment in a cloze answer with no backslash, and
    `srs.ts` read it as the card's own, so a rating rewrote it there and the
    line, `line` with its marker, no longer hashes to the marker (#356). It is
    still that line when the import's line, the comment bare as then, hashes
    to the marker and differs from it in its schedule comments alone. A card
    of more lines is never such a line: a rating writes under its back.
    """
    expected = card_lines(card)
    found = _ANKI_ID.search(line)
    if len(expected) != 1 or found is None:
        return None
    then = expected[0].replace("<!--SR\\:", "<!--SR:")
    now = line[: found.start()].removesuffix(" ")
    # Each comment held by a stand-in, so the two hold as many in the same places.
    if digest([then]) != span.digest or _STATE.sub("\0", now) != _STATE.sub("\0", then):
        return None
    return [
        comment
        for comment, was in zip(_STATE.findall(now), _STATE.findall(then), strict=True)
        if comment != was
    ]


def _start(lines: list[str], at: int, last: str, hashed: str) -> int | None:
    """Where the card ending in `last`, at line `at`, starts: None if none hashes to `hashed`.

    `last` is the marker's line without the marker. See `_spans`.
    """
    card = [last]
    for top in range(at, max(at - _SPAN_LIMIT, -1), -1):
        if top < at:
            if not lines[top].strip():
                return None
            card.insert(0, lines[top])
        if digest(card) == hashed:
            return top
    return None


def _spans(lines: list[str]) -> dict[tuple[int, int], _Span]:
    """Every marked card in `lines`, by its Anki note and template.

    A card is the fewest lines ending at its marker that hash to the hash the
    marker holds: one for a card of one line, more for a `?` card, whose state
    may sit on the line under its marker, where `srs.ts` splices it. A blank
    line or `_SPAN_LIMIT` ends the search, since a card holds no blank line,
    and a card not found by then was edited since and is marked so. The
    lines around a card, which may be anyone's, never move where it starts
    or ends; they only say whether `srs.ts` reads it as part of a card around
    it, which `_Span.inside` holds.
    """
    spans: dict[tuple[int, int], _Span] = {}
    code = _fenced(lines)
    for at, line in enumerate(lines):
        found = _ANKI_ID.search(line)
        if found is None:
            continue
        start = _start(lines, at, line[: found.start()].removesuffix(" "), found[3])
        end, state = at, line[found.end() :]
        below = lines[at + 1] if at + 1 < len(lines) else ""
        block = start is not None and start < at
        if block and below.startswith(("<!--SR:", "!suspended")):
            end, state = at + 1, f"{state} {below}"
        inside = False
        if start is not None:
            # Up over the lines `srs.ts` runs a back over, inline and cloze
            # lines among them; any `?` there counts, since a card left stale
            # is a smaller loss than a schedule taken from the user's card.
            # A `?` in code is code.
            row = start - 1
            while row >= 0 and not _ends_back(lines[row], code[row]) and not inside:
                inside = not code[row] and lines[row].strip() == "?"
                row -= 1
        if block and end == at:
            inside = inside or not _ends_back(below, at + 1 < len(lines) and code[at + 1])
        spans.setdefault(
            (int(found[1]), int(found[2])),
            _Span(
                at if start is None else start,
                end,
                found[3],
                start is not None,
                _TOKEN_WORD.search(state) is not None,
                _STATE.findall(state),
                inside,
            ),
        )
    return spans


def _ends_back(line: str, code: bool) -> bool:
    """Whether `srs.ts` ends a `?` card's back before `line`, a note's line as it stands.

    `ends_card` and a schedule comment of either kind anywhere on the line, as
    `schedules` in `parseCards` reads one. In a closed fence, `code`, only the
    schedule and the token do: a blank line, a heading or tags there end no
    card (#675).
    """
    stripped = line.strip()
    held = stripped.startswith("!suspended") or _STATE.search(line) is not None
    return held or (not code and ends_card(stripped))


def _fenced(lines: list[str]) -> list[bool]:
    """Which of `lines` sit in a fenced code block a later fence closes, the fences among them.

    An opener is a `fence` line, and a fence of its character at least as long,
    with nothing after it, closes it. One never closed runs to the end, where
    `srs.ts` reads breaks as outside code (#680), so nothing after it is code.
    """
    code = [False] * len(lines)
    at = 0
    while at < len(lines):
        found = fence(lines[at])
        if found is None:
            at += 1
            continue
        opener = lines[at][found:]
        mark, size = opener[0], len(opener) - len(opener.lstrip(opener[0]))
        for row in range(at + 1, len(lines)):
            shut = fence(lines[row])
            rest = lines[row][shut:].rstrip() if shut is not None else ""
            if len(rest) >= size and rest == mark * len(rest):
                code[at : row + 1] = [True] * (row + 1 - at)
                at = row + 1
                break
        else:
            break
    return code
