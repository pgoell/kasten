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

    A `?` line above, with nothing ending a back between, makes it that card's answer (#684).
    Or a `?` card with no state under it and a line below that no back ends at takes the
    schedule further down as its own.
    """


def merge(old: str, deck: Deck) -> Merged | None:
    """The note `old` with `deck` imported into it again, or None when `old` holds no marker.

    Changed cards are rewritten with their parking token and schedules. Edited ones are kept,
    as is a card the export lacks. Other lines come through byte for byte, CRLF included.
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
    """`lines` with each span in `replaced` swapped for its new lines, and how many were.

    A span starting inside one already swapped is left alone: two cards cannot share a line.
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

    0.49.2 wrote a cloze answer's schedule comment without a backslash, so a rating rewrote
    it there and the marker stopped matching (#356). The bare form still hashes to the marker
    and differs only in its schedule comments, and only for a one-line card.
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

    A card is the fewest lines ending at its marker that hash to the marker's hash. A blank
    line or `_SPAN_LIMIT` ends the search, and a card not found by then was edited since.
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
            # Any `?` above counts: a stale card is a smaller loss than a schedule
            # taken from the user's card. A `?` in code is code.
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
    """Whether `srs.ts` ends a `?` card's back before `line`, as the line stands.

    A schedule comment or the parking token always does. In a closed fence, `code`, a blank
    line, heading or tags end no card (#675).
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
