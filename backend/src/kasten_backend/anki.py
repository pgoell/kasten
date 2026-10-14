"""Reading an Anki `.apkg` export into decks of front-and-back cards.

An `.apkg` is a zip around an sqlite database, so the whole reader is standard
library: `zipfile`, `sqlite3`, and `compression.zstd` for the collection Anki
writes today. A dependency would buy nothing a few queries do not.

A card is what Anki shows, not what the note holds. A note has as many fields as
its note type declares, and each card row names one of the type's templates; the
question is that template's front rendered over the note's fields, the answer
its back. The renderer below is the part of Anki's template language a card
needs to come out the same: field replacements, filters, and conditional
sections. A cloze note type is the exception and keeps its first two fields,
the text with its marks and the Back Extra, because kasten reads Anki's cloze
marks itself and asks one card per number from the one line (#233).

Media is carried. The image or sound a field names lives in the zip under a
numbered name that only the export's `media` map translates, a JSON object in
the legacy export and zstd-compressed protobuf in the latest. A file the vault
would take becomes `![](path)` in the card, the path being where `import_anki`
writes it beside the deck's note; one it would not, or one the zip lacks, is
dropped from the text, since a note rendering a broken image is worse than a
card without it. Reading stays pure: the deck hands the bytes to its caller.
"""

import hashlib
import html
import io
import json
import re
import sqlite3
import tempfile
import zipfile
from collections import defaultdict
from compression import zstd
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import quote, unquote

from kasten_backend.files import ASSET_LIMIT_BYTES, temporary_name
from kasten_backend.vault import AUDIO_SUFFIXES, IMAGE_SUFFIXES, fits, legal_name

if TYPE_CHECKING:
    from collections.abc import Mapping

SEPARATOR = "\x1f"
"""Anki's separator: it joins a note's fields, and from schema 18 the levels of a deck name."""

COLLECTION_MEMBERS = ("collection.anki21b", "collection.anki21", "collection.anki2")
"""The collection an export may hold, newest first.

An export written by a recent Anki holds several of these at once, the older
ones being a stub kept so an older Anki opening the file says so rather than
crashing. Reading them in this order is what keeps the stub out.
"""

ZSTD_MEMBER = "collection.anki21b"
"""The collection member that is compressed rather than an sqlite file as it stands."""

ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
"""What a zstd frame starts with.

The latest export compresses its media map and every media file, the legacy
one neither, and nothing else in the zip says which form a member is in.
"""

MEDIA_SUFFIXES = (*IMAGE_SUFFIXES, *AUDIO_SUFFIXES)
"""What a field's image or sound may be to come through: an asset, and no book."""

_LINK_SAFE = "/;,@&=+$!*'"
"""What `media_path` leaves unescaped: `encodeURI`'s reserved set less `#` and `?`.

That is `encodePath` in `note-path.ts`, less `:` and the parens besides. A `::`
in a link would split the card line, a lone paren would end the link early, and
the server decodes all three back.
"""

_NAME_LIMIT_BYTES = 255
"""The longest file name a filesystem takes, which `vault.py` holds to as well."""

CLOZE_KIND = 1
"""A note type's kind when it is a cloze type, in `col.models` and in its protobuf config alike."""

_CLOZE = re.compile(r"\{\{c\d+::(.*?)(?:::.*?)?\}\}")
"""One cloze deletion, with the hint the author may have written after it.

The hint is part of the match and not of the group, so the highlight a note of
another type gets drops it: Anki shows marks there as typed, and a mark kept
would make kasten ask a card Anki never did.
"""
_MARK = re.compile(r"\{\{c([0-9]+)::([^{}]+?)(?:::([^{}]*?))?\}\}")
"""A cloze mark kasten reads: `MARK` in `card-line.ts`, character for character.

Narrower than `_CLOZE`, taking no brace and no empty text, so a MathJax
`{{c1::\\(x^{2}\\)}}` is a mark to Anki and not to kasten. `[0-9]` because
Python's `\\d` takes digits JavaScript's does not.
"""
_KEPT = re.compile("([0-9]+)")
"""The mark `plain` holds a cloze mark's place with, as `_HELD` does a link's."""
_SPACE = ""
"""A space the whitespace pass in `plain` leaves alone: a list's indent and `<pre>`'s own."""
_BLOCK = frozenset(
    {"br", "div", "p", "li", "ul", "ol", "pre", "blockquote", "tr", "hr"}
    | {f"h{level}" for level in range(1, 7)}
)
"""The tags a line ends at, either side of them: a browser starts a new line for each."""
_BOLD = frozenset({"b", "strong", "u"})
"""Underline among them, since markdown has no underline and bold is the nearest stress."""
_ITALIC = frozenset({"i", "em"})
_FURIGANA = re.compile(r" ?([^ >{}:]+?)\[(.+?)\]")
"""Anki's furigana pattern: ` 漢字[かんじ]`, the space before the base saying where it starts.

Anki fills the furigana in after the cloze, by which time a mark is a tag
whose `>` stops the base. Read off the raw field here, the braces and colons
of `{{c1::` stop it instead.
"""
_RUBY_TAG = re.compile(r"<(/?)(ruby|rt)\b[^>]*>", re.IGNORECASE)
"""A ruby or rt tag, attributes and all, which a cloze mark keeps bare as a field does."""
_READING = {"furigana": r"<ruby>\1<rt>\2</rt></ruby>", "kanji": r"\1", "kana": r"\2"}
"""What each of Anki's three furigana filters makes of a `_FURIGANA` match."""

_SOUND = re.compile(r"\[sound:([^\]]*)\]")
_IMAGE = re.compile(
    r"""<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>""", re.IGNORECASE
)
"""An `<img>` and its `src`, quoted either way or not at all."""
_HELD = re.compile("(\\d+)")
"""The mark `plain` holds a link's place with: private-use characters no field holds."""
_CODE = re.compile(r"<(script|style)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_BREAK = re.compile(r"<\s*(?:br\s*/?|/\s*(?:div|p))\s*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]*>")
_TOKEN = re.compile(r"\{\{(.*?)\}\}|<!--.*?-->", re.DOTALL)
"""A handlebar or an HTML comment: Anki lexes the comment whole, so a field inside it is not one."""
_VARINT, _LENGTH = 0, 2
_FIXED = {1: 8, 5: 4}
"""The protobuf wire types of a fixed-width field, against how many bytes it takes."""
_EMPTY = re.compile(r"(?:\s|</?(?:br|div) ?/?>)*", re.IGNORECASE)
"""Anki's own test for an empty field: an editor leaves `<br>` and `<div>` behind."""
_SCHEDULE = re.compile(r"<!--SR:!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->")
"""`SR` in `card-line.ts`, the whole comment: `srs.ts` stops a back at nothing less."""
_ANKI_ID = re.compile(r"<!--anki:(\d+):(\d+):([0-9a-f]{8})-->")
"""`ANKI_ID` in `card-line.ts`: the Anki note, template and hash `as_note` writes after a card."""
_SPAN_LIMIT = 200
"""The most lines `_spans` takes a card to run over, so a long note costs this a card at most."""
_STATE = re.compile(r"<!--SR:[^>]*?-->")
"""A schedule comment of either kind, plain or a cloze number's, which a re-import carries over."""
_TOKEN_WORD = re.compile(r"(?:^|\s)!suspended(?=\s|$)")
"""The parking token whole, as `suspended()` in `card-line.ts` reads it."""
_HEADING = re.compile(r"#{1,6}[ \t]")
"""`HEADING` in `srs.ts`."""
_ONLY_TAGS = re.compile(r"(?:#[^\W\d][\w/-]*[ \t]*)+")
"""`ONLY_TAGS` in `deck-tag.ts`, `[^\\W\\d]` and `\\w` standing in for the `\\p{L}` `re` lacks."""


@dataclass(frozen=True)
class Template:
    """One card template of a note type: its front and its back."""

    name: str
    qfmt: str
    afmt: str


REVIEW = 2
"""A card row's `type` when Anki has it in review, the one kind with a schedule worth carrying."""


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


@dataclass(frozen=True)
class _Rendered:
    """One card before `plain`, which needs to know first which media came through."""

    deck: str
    question: str
    answer: str
    fields: dict[str, str]
    template: Template
    kind: _NoteType
    nid: int
    ord: int
    reviews: tuple[Review, ...]


@dataclass(frozen=True)
class _NoteType:
    name: str
    cloze: bool
    fields: list[str]
    templates: dict[int, Template]


@dataclass(frozen=True)
class _Field:
    key: str
    filters: list[str]


@dataclass(frozen=True)
class _Section:
    key: str
    negated: bool
    children: list[_Node]


type _Node = str | _Field | _Section


def plain(field: str, links: Mapping[str, str] | None = None, *, cloze: bool = False) -> str:
    """One Anki field as markdown, a line for each line the field shows (#234).

    `_Markdown` gives the formatting a card can hold. No line is blank, since
    `srs.ts` ends a `?` card at a blank line, and a line any reader would take
    for part of the format, a heading, a lone `?`, a line of tags, the parking
    token, a schedule comment, carries a backslash so it reads as the text it
    was. An image or a sound whose name `links` maps becomes `![](link)`, and
    any other is dropped.

    A cloze mark stays as it is with its hint where `cloze` says the field is a
    cloze note's text and kasten reads the mark, and is otherwise a
    `==highlight==`: a mark kasten does not read would leave its `::` to split
    the line as a card. A cloze note's text is one line whatever it holds,
    since `srs.ts` reads the line over a `?` as the cloze and a line above it
    holding a mark as another.
    """
    held: list[str] = []

    def hold(match: re.Match[str]) -> str:
        link = (links or {}).get(_name(match))
        if link is None:
            return ""
        held.append(f"![]({link})")
        # A mark rather than the link, which the passes below would unescape
        # and could split; it goes back in at the end.
        return f"{len(held) - 1}"

    text = _SOUND.sub(hold, field)
    text = _IMAGE.sub(hold, text)
    # Before the parse, which would leave a script's code behind as prose.
    text = _CODE.sub("", text)
    kept: list[str] = []
    # Readable marks first where they are kept, so the highlight cannot swallow
    # one inside a mark kasten does not read.
    for pattern in (_MARK, _CLOZE) if cloze else (_CLOZE,):

        def keep(match: re.Match[str], pattern: re.Pattern[str] = pattern) -> str:
            # Out of the parse and flat, so `{{c2::<b>France</b>}}` asks `France`,
            # which is what a typed answer is held against. Ruby stays, and
            # `srs.ts` takes the reading off before comparing.
            if pattern is _MARK:
                kept.append(_flat(match[0]))
            else:
                inner = _KEPT.sub(lambda mark: kept[int(mark[1])], match[1])
                kept.append(f"=={_flat(inner)}==")
            return f"{len(kept) - 1}"

        text = pattern.sub(keep, text)

    parser = _Markdown()
    parser.feed(text)
    parser.close()
    # `split()` counts the non-breaking space `&nbsp;` as whitespace, which is
    # what turns it into an ordinary space.
    lines = [" ".join(line.split()).replace(_SPACE, " ") for line in parser.text().split("\n")]
    lines = [line for line in lines if line]
    if cloze:
        lines = [" ".join(lines)]
    text = "\n".join(_escaped(line) for line in lines)
    text = _KEPT.sub(lambda mark: kept[int(mark[1])], text)
    return _HELD.sub(lambda mark: held[int(mark[1])], text)


def _flat(text: str) -> str:
    """`text` as one line, every tag but ruby's stripped: how a cloze mark is written.

    The token is escaped here as `_Markdown` escapes it in the rest of the
    field, since `suspended()` in `card-line.ts` reads it inside a mark too,
    and so is the import's marker, as `_escaped` escapes it.
    """
    # Ruby's tags held out bare, with private-use marks, so the strip passes them by.
    text = _RUBY_TAG.sub(lambda tag: f"{tag[1]}{tag[2].lower()}", text)
    text = html.unescape(_TAG.sub("", _BREAK.sub(" ", text)))
    text = text.replace("", "<").replace("", ">")
    text = " ".join(text.split()).replace("!suspended", "\\!suspended")
    return text.replace("<!--anki:", "<!--anki\\:")


def _escaped(line: str) -> str:
    """`line` with a backslash where a reader would take it for the format rather than text.

    Each is a line `srs.ts` ends a `?` card on or reads as a divider, as
    `_ends_card` lists them. The schedule comment takes its backslash inside,
    since `SR` in `card-line.ts` matches anywhere on a line and a backslash
    before the `<` would leave one whole. The import's marker does the same,
    or a re-import would take the text for a card it wrote.
    """
    if (
        line == "?"
        or line.startswith("!suspended")
        or _HEADING.match(line) is not None
        or _ONLY_TAGS.fullmatch(line) is not None
    ):
        line = f"\\{line}"
    return line.replace("<!--SR:", "<!--SR\\:").replace("<!--anki:", "<!--anki\\:")


def _ticks(code: str) -> str:
    """`code` as inline code, its fence one backtick longer than any run inside it."""
    longest = max((len(run) for run in re.findall("`+", code)), default=0)
    pad = " " if code.startswith("`") or code.endswith("`") else ""
    return f"{'`' * (longest + 1)}{pad}{code}{pad}{'`' * (longest + 1)}"


class _Markdown(HTMLParser):
    """A field's HTML as markdown, a line break apart, and not yet tidied.

    The formatting a card holds and no more: bold, italic, links, inline code,
    lists and ruby, with every tag past those dropped and its text kept. A
    `<pre>` is a line of inline code per line rather than a fence, because both
    readers skip every card inside a fence. Text is escaped where markdown
    would read it, and the markdown written around it is not.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.depth = {"**": 0, "*": 0}
        self.opened: dict[str, int] = {}
        """Where each open emphasis started in `out`, so its close can wrap what came after."""
        self.lists: list[int | None] = []
        """The open lists, innermost last: the next number of an `<ol>`, None for a `<ul>`."""
        self.links: list[tuple[int, str | None]] = []
        self.code: list[int] = []
        self.pre: int | None = None
        self.skip = 0
        self.ruby = 0

    def text(self) -> str:
        return "".join(self.out)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _BLOCK:
            self.out.append("\n")
        marker = "**" if tag in _BOLD else "*" if tag in _ITALIC else None
        if marker is not None:
            self.depth[marker] += 1
            # Once, so `<b><u>x</u></b>` is not `****x****`.
            if self.depth[marker] == 1:
                self.opened[marker] = len(self.out)
        elif tag in ("ul", "ol"):
            self.lists.append(1 if tag == "ol" else None)
        elif tag == "li":
            number = self.lists[-1] if self.lists else None
            if number is not None:
                self.lists[-1] = number + 1
            indent = _SPACE * 2 * max(len(self.lists) - 1, 0)
            self.out.append(f"{indent}{'- ' if number is None else f'{number}. '}")
        elif tag == "a":
            self.links.append((len(self.out), dict(attrs).get("href")))
        elif tag == "code" and self.pre is None:
            self.code.append(len(self.out))
        elif tag == "pre" and self.pre is None:
            self.pre = len(self.out)
        elif tag == "rp":
            # The parentheses a browser without ruby shows, which kasten draws.
            self.skip += 1
        elif tag == "ruby":
            self.ruby += 1
            self.out.append("<ruby>")
        elif tag == "rt" and self.ruby:
            self.out.append("<rt>")

    def handle_endtag(self, tag: str) -> None:
        marker = "**" if tag in _BOLD else "*" if tag in _ITALIC else None
        if marker is not None and self.depth[marker] > 0:
            self.depth[marker] -= 1
            if self.depth[marker] == 0:
                self._wrap(self.opened.pop(marker), marker)
        elif tag in ("ul", "ol") and self.lists:
            self.lists.pop()
        elif tag == "a" and self.links:
            at, href = self.links.pop()
            # A link holds no line break, so a break in its text is a space.
            inner = " ".join("".join(self.out[at:]).split("\n"))
            if href and inner.strip():
                # Parens and spaces would end the link early, as in `_LINK_SAFE`.
                address = href.replace(" ", "%20").replace("(", "%28").replace(")", "%29")
                self.out[at:] = [f"[{inner.strip()}]({address})"]
        elif tag == "code" and self.code:
            at = self.code.pop()
            lines = "".join(self.out[at:]).split("\n")
            self.out[at:] = ["\n".join(_ticks(line) if line.strip() else line for line in lines)]
        elif tag == "pre" and self.pre is not None:
            inner = "".join(self.out[self.pre :]).replace(" ", _SPACE).replace("\t", _SPACE)
            lines = [line for line in inner.split("\n") if line.replace(_SPACE, "").strip()]
            self.out[self.pre :] = ["\n", *(f"{_ticks(line)}\n" for line in lines)]
            self.pre = None
        elif tag == "rp" and self.skip:
            self.skip -= 1
        elif tag == "rt" and self.ruby:
            self.out.append("</rt>")
        elif tag == "ruby" and self.ruby:
            self.ruby -= 1
            self.out.append("</ruby>")
        if tag in _BLOCK:
            self.out.append("\n")

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        if self.pre is None:
            data = re.sub(r"\s+", " ", data)
        if self.pre is None and not self.code:
            data = re.sub(r"[*_`\[]", r"\\\g<0>", data)
            data = re.sub("={2,}", lambda run: "\\=" * len(run[0]), data)
            # Anywhere, since `suspended()` in `card-line.ts` reads the token
            # after any space and would park a card that only names it.
            data = data.replace("!suspended", "\\!suspended")
        self.out.append(data)

    def _wrap(self, at: int, marker: str) -> None:
        """Everything since `at` in `marker`, line by line, the spaces at either end left outside.

        `** f **` is no bold to markdown, and an emphasis does not run over a
        line break.
        """
        lines: list[str] = []
        for line in "".join(self.out[at:]).split("\n"):
            core = line.strip()
            start = len(line) - len(line.lstrip())
            end = start + len(core)
            lines.append(f"{line[:start]}{marker}{core}{marker}{line[end:]}" if core else line)
        self.out[at:] = ["\n".join(lines)]


def media_path(folder: str, deck: str, name: str) -> str:
    """Where the file `name` of `deck` goes, vault-relative: a folder beside the deck's note."""
    return "/".join(part for part in (folder, f"{deck} media", name) if part)


def read_apkg(data: bytes, folder: str = "", *, carry: bool = False) -> list[Deck]:
    """Every deck `data` holds, sorted by name and without the empty ones.

    `folder` is where the deck notes go. A card links each image and sound it
    can carry at `media_path`, and its deck holds the bytes for the caller to
    write there. With `carry`, a card holds its `reviews`, which `as_note` and
    `merge` write as schedules.

    Raises:
        ValueError: `data` is not a zip, or holds no collection, or holds one
            zstd or sqlite refuses to read, or one whose decks, note types or
            note fields cannot be read, or a media map that cannot be read.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as bundle:
            rendered = _rendered(_collection(bundle), carry=carry)
            index = _media_index(bundle)
            wanted = {name for card in rendered for name in _names(card.question, card.answer)}
            files = {name: found for name in wanted if (found := _media_file(bundle, index, name))}
    except zipfile.BadZipFile as error:
        raise ValueError("not an Anki export: the bytes are not a zip") from error

    cards: defaultdict[str, list[Card]] = defaultdict(list)
    carried: defaultdict[str, dict[str, bytes]] = defaultdict(dict)
    for card in rendered:
        links: dict[str, str] = {}
        for name in _names(card.question, card.answer):
            if name in files:
                file, blob = files[name]
                carried[card.deck][file] = blob
                links[name] = quote(media_path(folder, card.deck, file), safe=_LINK_SAFE)
        cards[card.deck].append(
            Card(
                plain(card.question, links, cloze=card.kind.cloze),
                # Back Extra shows its marks as typed in Anki, and kept here
                # they would make the `?` back a cloze of its own.
                plain(card.answer, links),
                card.fields,
                card.template,
                card.kind.name,
                card.kind.cloze,
                card.nid,
                card.ord,
                card.reviews,
            )
        )

    return [Deck(name, deck, carried[name]) for name, deck in sorted(cards.items())]


def _names(*texts: str) -> list[str]:
    """Every media name the `<img>` and `[sound:]` in `texts` give, the way `plain` reads them."""
    return [
        _name(match)
        for text in texts
        for pattern in (_SOUND, _IMAGE)
        for match in pattern.finditer(text)
    ]


def _name(match: re.Match[str]) -> str:
    """The name a `_SOUND` or `_IMAGE` match gives, unescaped since the field is HTML."""
    return html.unescape(next(group for group in match.groups() if group is not None))


def _rendered(blob: bytes, *, carry: bool) -> list[_Rendered]:
    """Every card the collection `blob` makes, its sides rendered and not yet plain.

    The schedule columns are read only with `carry`, so an import that does
    not want them does not depend on them.
    """
    with tempfile.TemporaryDirectory() as folder:
        # sqlite3 opens a path rather than bytes, so the collection has to touch
        # a disk somewhere before it can be read.
        path = Path(folder) / "collection.anki2"
        path.write_bytes(blob)
        with closing(sqlite3.connect(path)) as db:
            try:
                notes = {
                    nid: (mid, flds)
                    for nid, mid, flds in db.execute("SELECT id, mid, flds FROM notes")
                }
                card_rows = db.execute(
                    "SELECT nid, did, ord FROM cards ORDER BY nid, ord"
                ).fetchall()
                names = _deck_names(db)
                types = _note_types(db)
                reviews = _reviews(db) if carry else {}
            except sqlite3.Error as error:
                raise ValueError(f"unreadable Anki collection: {error}") from error

    if notes and not any(mid in types for mid, _ in notes.values()):
        raise ValueError("no note type in the collection matches its notes")

    rendered: list[_Rendered] = []
    clozed: set[int] = set()
    for nid, did, ord_ in card_rows:
        note = notes.get(nid)
        kind = types.get(note[0]) if note else None
        name = names.get(did)
        if note is None or kind is None or name is None:
            continue
        # sqlite keeps whatever type a row was written with, whatever the
        # column says, so a broken export can hold its fields as a blob.
        if not isinstance(note[1], str):
            raise ValueError(f"unreadable Anki export: note {nid} holds its fields as {note[1]!r}")
        values = note[1].split(SEPARATOR)
        fields = dict(zip(kind.fields, values + [""] * len(kind.fields), strict=False))
        if kind.cloze:
            # One line per note, however many deletions it has: the rows differ
            # only in which number they hide, and kasten asks each number from
            # the one line.
            if nid in clozed or not kind.templates:
                continue
            clozed.add(nid)
            which = min(kind.templates)
            template = kind.templates[which]
            question, answer = values[0], values[1] if len(values) > 1 else ""
        else:
            which = ord_
            template = kind.templates.get(ord_)
            if template is None:
                continue
            question, filled = _render(_parse(template.qfmt), fields, question=True)
            if not filled:
                continue
            answer, _ = _render(_parse(template.afmt), fields, question=False)
        # A cloze line holds every number's rows, the others their own.
        held = tuple(r for r in reviews.get(nid, ()) if kind.cloze or r.ord == ord_)
        rendered.append(_Rendered(name, question, answer, fields, template, kind, nid, which, held))

    return rendered


def _reviews(db: sqlite3.Connection) -> dict[int, list[Review]]:
    """Every card row in review, by its note, in template order.

    A review card's `due` is a day counted from `col.crt`, when the collection
    was made, in seconds since the epoch.

    Raises:
        ValueError: `col` has no row, or a `crt` that is not a whole number.
    """
    row = db.execute("SELECT crt FROM col").fetchone()
    # sqlite keeps whatever type a row was written with, so a broken export
    # can hold the time as text or nothing at all.
    crt = row[0] if row else None
    if not isinstance(crt, int):
        raise ValueError(f"unreadable Anki export: the collection was made at {crt!r}")
    start = datetime.fromtimestamp(crt, UTC).date()
    held: defaultdict[int, list[Review]] = defaultdict(list)
    for nid, ord_, ivl, factor, due in db.execute(
        "SELECT nid, ord, ivl, factor, due FROM cards WHERE type = ? ORDER BY nid, ord", (REVIEW,)
    ):
        held[nid].append(Review(ord_, start + timedelta(days=due), ivl, factor // 10))
    return held


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
    the `?` card's front and back do not run into the lines next to it. It is
    left out where a side cannot stand in that form: an empty back, since
    `srs.ts` asks no `?` with nothing under it and `review.ts` would count one;
    a line of `?`, which `review.ts` counts as a second card; and a line
    `srs.ts` ends a card on, a heading, a line of tags, the parking token or,
    on the back only, a schedule comment, which drops the `?` card there and
    reads the front at its first `::` after all. `note_cards` holds these
    rules. `plain` escapes every such line, so only a card built by hand meets
    them. A front over lines with no back and no `::` is the one-line form
    that parks a question, its breaks spaces.

    Two sides are written other than as they read, so that they read back as
    Anki showed them (#243): a front ending in `:` gets a space before the
    divider, and a side opening a line with three backticks gets a backslash.

    A cloze note holding a mark is a cloze, its marks being what tell kasten
    so, and is never left out. With a Back Extra that can stand as a `?` back,
    over as many lines as it holds, it takes the `?` form; with none, or one
    that cannot, it is its line alone and the extra is lost, which is less than
    losing the card. A cloze note with no mark is a card like any other.

    Every card ends in `<!--anki:NID:ORD-->`, its Anki note and template, after
    its last line, which is how `merge` finds it when the deck comes again. A
    card holding `reviews` takes their schedules as a rating would write them.
    """
    # A tag runs to the first space, so a deck called "AWS Certification" would
    # otherwise land in a deck called `AWS` with the rest of its name read as
    # prose. The note's `# heading` is not the deck name; the tag is.
    head = [f"#flashcards/{re.sub(r'\s+', '-', deck.name)}", ""]
    body: list[str] = []
    for card in note_cards(deck):
        _place(body, _with_state(_marked(card, _lines(card)), False, _carried(card)))
    # The blank a `?` card leaves under itself is a separator, not part of the
    # note, so the last one comes off rather than ending the note on two breaks.
    if body and not body[-1]:
        body.pop()
    return "\n".join(head + body) + "\n"


def _lines(card: Card) -> list[str]:
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
    return [*map(_unfenced, fronts), "?", *map(_unfenced, backs)]


def _marked(card: Card, lines: list[str]) -> list[str]:
    """`lines` with the card's marker after the last, where no rating writes."""
    return [*lines[:-1], f"{lines[-1]} <!--anki:{card.nid}:{card.ord}:{_digest(lines)}-->"]


def _digest(lines: list[str]) -> str:
    """The hash a marker holds of the unmarked `lines` it ends.

    It is what tells `merge` where the card starts, and whether its lines are
    still the ones the import wrote or ones edited since in kasten.
    """
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()[:8]


def _place(body: list[str], lines: list[str]) -> None:
    """`lines` added to `body`, a `?` card with a blank line either side of it.

    So the `?` card's front and back do not run into the lines next to it.
    """
    if len(lines) == 1:
        body.append(lines[0])
        return
    if body and body[-1]:
        body.append("")
    body += [*lines, ""]


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
    """Whether it is a card of one line with a `?` line above it and no blank between.

    `srs.ts` reads such a line as part of that `?` card's answer, someone's own
    card, whose schedule may sit under it; so it is never rewritten.
    """


def merge(old: str, deck: Deck) -> Merged | None:
    """The note `old` with `deck` imported into it again, or None when `old` holds no marker.

    A card is found by its marker. One whose lines `_lines` would write the
    same now is kept as it stands, and one Anki changed is written anew, the
    parking token and the schedules a rating left on it carried into its new
    shape. One edited in kasten since is kept too, whatever Anki did: the edit
    is the user's, and the marker's hash no longer finding the card says so. A
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
            added.append(_with_state(_marked(card, _lines(card)), False, _carried(card)))
        elif span.digest == _digest(_lines(card)) or not span.found or span.inside:
            kept += 1
        else:
            card_lines = _with_state(_marked(card, _lines(card)), span.suspended, span.comments)
            replaced[span.start] = (span, card_lines)

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
        for card_lines in added:
            _place(out, card_lines)
        if not out[-1]:
            out.pop()
        out.append("")
    removed = len(spans.keys() - {(card.nid, card.ord) for card in note_cards(deck)})
    # Untouched, the note comes back as it was, whatever its line ends.
    text = ("\r\n" if crlf else "\n").join(out) if added or updated else old
    return Merged(text, len(added), updated, kept, removed)


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


def _spans(lines: list[str]) -> dict[tuple[int, int], _Span]:
    """Every marked card in `lines`, by its Anki note and template.

    A card is the fewest lines ending at its marker that hash to the hash the
    marker holds: one for a card of one line, more for a `?` card, whose state
    may sit on the line under its marker, where `srs.ts` splices it. A blank
    line or `_SPAN_LIMIT` ends the search, since a card holds no blank line,
    and a card not found by then was edited since and is marked so. Nothing
    is guessed from the lines around a card, which may be anyone's.
    """
    spans: dict[tuple[int, int], _Span] = {}
    for at, line in enumerate(lines):
        found = _ANKI_ID.search(line)
        if found is None:
            continue
        card = [line[: found.start()].removesuffix(" ")]
        start = None
        for top in range(at, max(at - _SPAN_LIMIT, -1), -1):
            if top < at:
                if not lines[top].strip():
                    break
                card.insert(0, lines[top])
            if _digest(card) == found[3]:
                start = top
                break
        end, state = at, line[found.end() :]
        below = lines[at + 1] if at + 1 < len(lines) else ""
        if start is not None and start < at and below.startswith(("<!--SR:", "!suspended")):
            end, state = at + 1, f"{state} {below}"
        inside = False
        if start == at:
            row = at - 1
            while row >= 0 and lines[row].strip() and not inside:
                inside = lines[row].strip() == "?"
                row -= 1
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


def note_cards(deck: Deck) -> list[Card]:
    """The cards of `deck` that `as_note` writes, in order, by the rules its docstring gives.

    Its own function so the import's count and the note agree on which they are.
    """
    return [
        card
        for card in deck.cards
        if card.front and (_clozed(card) or _one_line(card) or _divides(card))
    ]


def _one_line(card: Card) -> bool:
    """Whether `card` is written as `front::back`: no `::` to split it, and no side over lines.

    A front over lines with no back is, its breaks spaces, since a `?` with
    nothing under it is no card.
    """
    return "::" not in card.front and (not card.back or "\n" not in card.front + card.back)


def card_count(deck: Deck) -> int:
    """How many cards the note `as_note` writes holds: a cloze is one per number it marks."""
    return sum(
        # As numbers, since `c01` and `c1` are one card to Anki.
        len({int(mark[1]) for mark in _MARK.finditer(card.front)}) if _clozed(card) else 1
        for card in note_cards(deck)
    )


def _clozed(card: Card) -> bool:
    """Whether `card` is written as a cloze: a cloze note's text holding a mark kasten reads."""
    return card.cloze and _MARK.search(card.front) is not None


def _divides(card: Card) -> bool:
    """Whether `card` can stand as front, `?` and back, by `as_note`'s rules, line by line.

    A back holding a marker cannot, since `merge` would read the card as ending there.
    """
    lines = [*card.front.splitlines(), *card.back.splitlines()]
    return bool(card.back) and not (
        any(_ends_card(line) or line == "?" for line in lines)
        or _SCHEDULE.search(card.back)
        or "<!--anki:" in card.back
    )


def _unfenced(side: str) -> str:
    """`side` with a leading fence escaped, so it opens no code block in the note.

    `fences()` in `card-line.ts` reads any line opening with three backticks as a
    fence, and both readers skip every card inside one. The backslash is
    markdown's own escape, so the side still shows its backticks.
    """
    return f"\\{side}" if side.startswith("```") else side


def _ends_card(line: str) -> bool:
    """Whether `srs.ts` `breaks()` would end a `?` card on `line`, so it cannot be a side of one.

    A line of a side here is stripped, so blank means empty. The schedule `srs.ts`
    also stops a back at is checked apart, since it stops no front.
    """
    return (
        not line
        or line.startswith("!suspended")
        or _HEADING.match(line) is not None
        or _ONLY_TAGS.fullmatch(line) is not None
    )


def _parse(template: str) -> list[_Node]:
    """`template` as a tree of text, field replacements and conditional sections.

    One pass over the template, never over a field's value: a value holding
    `{{Back}}` is text, the way Anki shows it. A section left open runs to the
    end and a stray close is ignored, so a broken template still gives a card.
    """
    root: list[_Node] = []
    stack = [root]
    start = 0
    for match in _TOKEN.finditer(template):
        stack[-1].append(template[start : match.start()])
        start = match.end()
        if match.group(1) is None:
            # A comment, which Anki hands to the browser to hide; a markdown
            # line would show it, so it goes.
            continue
        # `{{{Front}}}` is a slip Anki forgives: the handlebar ends at the first
        # `}}`, the extra `{` is dropped, and the last `}` stays as text.
        tag = match.group(1).lstrip("{").strip()
        if tag.startswith(("#", "^")):
            section = _Section(tag[1:].strip(), tag[0] == "^", [])
            stack[-1].append(section)
            stack.append(section.children)
        elif tag.startswith("/"):
            if len(stack) > 1:
                stack.pop()
        else:
            *filters, key = tag.split(":")
            stack[-1].append(_Field(key.strip(), [f.strip() for f in filters]))
    stack[-1].append(template[start:])
    return root


def _render(nodes: list[_Node], fields: dict[str, str], *, question: bool) -> tuple[str, bool]:
    """`nodes` rendered over `fields`, and whether a non-empty field went into it.

    That second answer is Anki's test for making a card at all: a front of
    literal text and nothing else is still an empty front.
    """
    parts: list[str] = []
    filled = False
    for node in nodes:
        if isinstance(node, str):
            parts.append(node)
        elif isinstance(node, _Section):
            if _empty(fields.get(node.key, "")) != node.negated:
                continue
            text, inner = _render(node.children, fields, question=question)
            parts.append(text)
            filled = filled or inner
        else:
            value = _replacement(node, fields, question=question)
            parts.append(value)
            filled = filled or not _empty(value)
    return "".join(parts), filled


def _replacement(node: _Field, fields: dict[str, str], *, question: bool) -> str:
    """What one `{{...}}` shows.

    `FrontSide`, the special fields and a field the note type lacks all show
    nothing: the back would otherwise repeat the question, and the rest are
    Anki's view of the card rather than anything the author wrote.
    """
    # `type:` asks for typed input on the front and shows the field on the back;
    # `tts` reads it aloud. Neither has text a markdown line could carry.
    if any(f == "tts" or f.startswith("tts ") for f in node.filters):
        return ""
    if question and "type" in node.filters:
        return ""
    value = fields.get(node.key, "")
    # Innermost first, the filter by the field's name being the first applied.
    # The rest, `text:` and `hint:` among them, give the field as it is.
    for name in reversed(node.filters):
        if name in _READING:
            # Anki's own first step: its editor puts `&nbsp;` between words,
            # which would otherwise join the base of the reading after it.
            value = value.replace("&nbsp;", " ")
            value = _FURIGANA.sub(lambda match, name=name: _reading(match, name), value)
    return value


def _reading(match: re.Match[str], name: str) -> str:
    """What the furigana filter `name` makes of one `_FURIGANA` match, a sound left as it is."""
    if match[2].startswith("sound:"):
        return match[0]
    return match.expand(_READING[name])


def _empty(value: str) -> bool:
    return _EMPTY.fullmatch(value) is not None


def _collection(bundle: zipfile.ZipFile) -> bytes:
    """The sqlite bytes of the newest collection the export holds."""
    held = set(bundle.namelist())
    member = next((name for name in COLLECTION_MEMBERS if name in held), None)
    if member is None:
        raise ValueError(f"no Anki collection in the export: {sorted(held)}")
    blob = bundle.read(member)
    try:
        return zstd.decompress(blob) if member == ZSTD_MEMBER else blob
    except zstd.ZstdError as error:
        raise ValueError(f"unreadable Anki export: {member} is not zstd: {error}") from error


def _media_index(bundle: zipfile.ZipFile) -> dict[str, str]:
    """Every media file the export lists, by the name a field gives it, against its zip member.

    The legacy map is JSON from member to name. The latest is Anki's
    `MediaEntries`, its entries numbered by position unless one carries the
    `legacy_zip_filename` of field 255.
    """
    if "media" not in bundle.namelist():
        return {}
    raw = bundle.read("media")
    try:
        if not raw.startswith(ZSTD_MAGIC):
            return {name: member for member, name in json.loads(raw).items()}
        index: dict[str, str] = {}
        for number, entry in enumerate(_protobuf(zstd.decompress(raw)).get(1, [])):
            if not isinstance(entry, bytes):
                raise ValueError(f"entry {number} is not a message")
            legacy = _protobuf(entry).get(255)
            index[_string(entry, 1)] = str(legacy[0] if legacy else number)
    except (zstd.ZstdError, ValueError, AttributeError, TypeError) as error:
        raise ValueError(f"unreadable Anki export: bad media map ({error})") from error
    return index


def _media_file(
    bundle: zipfile.ZipFile, index: dict[str, str], name: str
) -> tuple[str, bytes] | None:
    """The file a field names as `name`, by its name in the vault and its bytes, or None.

    None for a file the vault would refuse as `store` would: a name that is not
    one plain file name the vault holds (hidden, or too long once its temp's
    fourteen bytes are added), a suffix it takes no image or sound under, a body over
    the cap or not what its suffix says. None too for one the zip lacks.
    """
    # Anki percent-encodes an `<img src>` in some versions, never the map.
    if name not in index:
        name = unquote(name)
    member = index.get(name)
    if (
        member is None
        or not name
        or any(char in name for char in "/\\\x00")
        or not legal_name(name)
        # The temp `store` streams into is longer than the name and has to fit too.
        or len(temporary_name(name).encode()) > _NAME_LIMIT_BYTES
        or Path(name).suffix.lower() not in MEDIA_SUFFIXES
        or member not in bundle.namelist()
        or bundle.getinfo(member).file_size > ASSET_LIMIT_BYTES
    ):
        return None
    data = bundle.read(member)
    if data.startswith(ZSTD_MAGIC):
        try:
            # Capped, since the size the zip states is the compressed one.
            data = zstd.ZstdDecompressor().decompress(data, max_length=ASSET_LIMIT_BYTES + 1)
        except zstd.ZstdError:
            return None
    if len(data) > ASSET_LIMIT_BYTES or not fits(Path(name).suffix.lower(), data):
        return None
    return name, data


def _deck_names(db: sqlite3.Connection) -> dict[int, str]:
    """Every deck id in the collection against its name, nesting spelled with `/`."""
    try:
        rows = db.execute("SELECT id, name FROM decks").fetchall()
    except sqlite3.OperationalError:
        # Before schema 18 there was no decks table: the whole deck list sat in
        # one JSON object on the single row of `col`, keyed by deck id, and
        # nesting was spelled `Certs::AWS` rather than with the separator.
        rows = db.execute("SELECT decks FROM col").fetchall()
        try:
            listing = json.loads(rows[0][0]) if rows else {}
            return {int(did): deck["name"].replace("::", "/") for did, deck in listing.items()}
        except (KeyError, TypeError, AttributeError) as error:
            raise ValueError(f"unreadable Anki export: bad deck list ({error!r})") from error
    # sqlite keeps whatever type a row was written with, so a name can be a blob.
    for did, name in rows:
        if not isinstance(name, str):
            raise ValueError(f"unreadable Anki export: deck {did} is named {name!r}")
    return {did: name.replace(SEPARATOR, "/") for did, name in rows}


def _note_types(db: sqlite3.Connection) -> dict[int, _NoteType]:
    """Every note type in the collection against its id.

    Raises:
        ValueError: the collection holds none, or one that cannot be read.
    """
    try:
        rows = db.execute("SELECT id, name, config FROM notetypes").fetchall()
    except sqlite3.OperationalError:
        types = _legacy_note_types(db)
    else:
        types = {}
        for ntid, name, config in rows:
            names = db.execute("SELECT name FROM fields WHERE ntid = ? ORDER BY ord", (ntid,))
            templates = {
                ord_: Template(tname, _string(tconfig, 1), _string(tconfig, 2))
                for ord_, tname, tconfig in db.execute(
                    "SELECT ord, name, config FROM templates WHERE ntid = ?", (ntid,)
                )
            }
            kind = _protobuf(config).get(1, [0])[0]
            types[ntid] = _NoteType(
                name, kind == CLOZE_KIND, [field for (field,) in names], templates
            )
    if not types:
        raise ValueError("no note types in the Anki collection")
    return types


def _legacy_note_types(db: sqlite3.Connection) -> dict[int, _NoteType]:
    """The note types of a collection older than schema 18, from the JSON on `col`."""
    rows = db.execute("SELECT models FROM col").fetchall()
    try:
        listing = json.loads(rows[0][0]) if rows and rows[0][0] else {}
        return {
            int(mid): _NoteType(
                kind["name"],
                kind.get("type") == CLOZE_KIND,
                [_text(f["name"]) for f in sorted(kind["flds"], key=lambda f: f["ord"])],
                {
                    t["ord"]: Template(t["name"], _text(t["qfmt"]), _text(t["afmt"]))
                    for t in kind["tmpls"]
                },
            )
            for mid, kind in listing.items()
        }
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError(f"unreadable Anki note types: {error!r}") from error


def _text(value: object) -> str:
    """`value` when the JSON held a string there, which the renderer needs to parse it."""
    if not isinstance(value, str):
        raise ValueError(f"unreadable Anki note types: {value!r} is not text")
    return value


def _string(message: bytes, number: int) -> str:
    """Field `number` of a protobuf `message` as text, or empty when it is not set."""
    value = _protobuf(message).get(number, [b""])[0]
    if not isinstance(value, bytes):
        raise ValueError(f"protobuf field {number} is not a string")
    return value.decode()


def _protobuf(message: bytes) -> dict[int, list[int | bytes]]:
    """The fields of a protobuf `message` by number: a varint as an int, the rest as bytes.

    Anki keeps a note type's kind and a template's front and back in protobuf
    blobs from schema 18. The wire format is simple enough that a reader is
    shorter than a dependency on one; a field this reader has no use for is
    stepped over by its wire type.

    Raises:
        ValueError: `message` is not well-formed protobuf.
    """
    fields: defaultdict[int, list[int | bytes]] = defaultdict(list)
    at = 0
    while at < len(message):
        key, at = _varint(message, at)
        number, wire = key >> 3, key & 7
        if wire == _VARINT:
            value, at = _varint(message, at)
            fields[number].append(value)
        elif wire == _LENGTH:
            size, at = _varint(message, at)
            if at + size > len(message):
                raise ValueError("protobuf field runs past the end of its message")
            fields[number].append(message[at : at + size])
            at += size
        elif wire in _FIXED:
            at += _FIXED[wire]
        else:
            raise ValueError(f"protobuf wire type {wire} is not one Anki writes")
    if at > len(message):
        raise ValueError("protobuf field runs past the end of its message")
    return fields


def _varint(message: bytes, at: int) -> tuple[int, int]:
    """The varint starting at `at`, and where the next field starts."""
    value = shift = 0
    while True:
        if at >= len(message):
            raise ValueError("protobuf varint runs past the end of its message")
        byte = message[at]
        value |= (byte & 0x7F) << shift
        at += 1
        shift += 7
        if not byte & 0x80:
            return value, at
