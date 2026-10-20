"""Reading an Anki `.apkg` export into decks of front-and-back cards.

An `.apkg` is a zip around an sqlite database, so the whole reader is standard
library: `zipfile`, `sqlite3`, and `compression.zstd` for the collection Anki
writes today. A dependency would buy nothing a few queries do not.

This module is the archive and its limits: the zip, the members read out of it,
and the media map. What the collection holds is `anki_collection`, which renders
each card through `anki_template`, and a field's HTML becomes markdown in
`anki_html`. A card is what Anki shows, not what the note holds. A note has as
many fields as its note type declares, and each card row names one of the
type's templates; the question is that template's front rendered over the note's
fields, the answer its back. A cloze note type is the exception and keeps its
first two fields, the text with its marks and the Back Extra, because kasten
reads Anki's cloze marks itself and asks one card per number from the one line
(#233).

Media is carried. The image or sound a field names lives in the zip under a
numbered name that only the export's `media` map translates, a JSON object in
the legacy export and zstd-compressed protobuf in the latest. A file the vault
would take becomes `![](path)` in the card, the path being where `import_anki`
writes it beside the deck's note; one it would not, or one the zip lacks, is
dropped from the text, since a note rendering a broken image is worse than a
card without it. Reading stays pure: the deck hands the bytes to its caller.
"""

import io
import json
import lzma
import struct
import zipfile
import zlib
from collections import defaultdict
from compression import zstd
from pathlib import Path
from urllib.parse import quote, unquote

from kasten_backend.anki_collection import media_map, rendered
from kasten_backend.anki_deck import Card, Deck
from kasten_backend.anki_html import media_names, plain
from kasten_backend.files import ASSET_LIMIT_BYTES, temporary_name
from kasten_backend.vault import AUDIO_SUFFIXES, IMAGE_SUFFIXES, fits, legal_name

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

MEMBER_LIMIT_BYTES = 1024 * 1024 * 1024
"""The most one member may unpack to, through the zip and zstd both.

A gibibyte, since the upload is capped at a hundred mebibytes and a collection
of text compresses some five times over: a real deck stays well under it, and a
bomb is stopped there rather than at the end of memory.
"""

TOTAL_LIMIT_BYTES = 2 * 1024 * 1024 * 1024
"""The most every member read may unpack to together, collection, media map and media.

The import holds all of it in memory at once, which is why the sum and not only
each member needs a cap.
"""

MEMBER_COUNT_LIMIT = 50_000
"""The most members an export may hold.

A real deck holds a member per image and sound, a few thousand in a big one.
Fifty thousand in a hundred mebibytes is two kibibytes each, less than any
picture worth carrying.
"""

_CHUNK_BYTES = 1024 * 1024
"""How much of a member `_member` reads at a time, so a cap is checked as it unpacks."""

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
            note fields cannot be read, or a media map that cannot be read; or
            one past `MEMBER_COUNT_LIMIT` members, or whose collection or
            media map unpacks past `MEMBER_LIMIT_BYTES`, or whose members read
            unpack past `TOTAL_LIMIT_BYTES` together; or one with a member zip
            cannot read, corrupt, encrypted or in a method it lacks, or a
            directory in a zip version past what it reads, or a member name
            flagged utf-8 that does not decode.
    """
    try:
        _count_members(data)
        with _opened(data) as bundle:
            budget = _Budget()
            rendered_cards = rendered(_collection(bundle, budget), carry=carry)
            index = _media_index(bundle, budget)
            wanted = {
                name for card in rendered_cards for name in media_names(card.question, card.answer)
            }
            files = {
                name: found
                for name in wanted
                if (found := _media_file(bundle, index, name, budget))
            }
    except zipfile.BadZipFile as error:
        raise ValueError("not an Anki export: the bytes are not a zip") from error
    except NotImplementedError as error:
        # Only the directory read gets here, `_member` turning its own into ValueError.
        raise ValueError(f"unreadable Anki export: {error}") from error

    cards: defaultdict[str, list[Card]] = defaultdict(list)
    carried: defaultdict[str, dict[str, bytes]] = defaultdict(dict)
    for card in rendered_cards:
        links: dict[str, str] = {}
        for name in media_names(card.question, card.answer):
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


class _Budget:
    """What the members of one export may still unpack to, out of `TOTAL_LIMIT_BYTES`.

    Both layers count, the bytes the zip inflates and the bytes zstd makes of
    them, since the import holds each in memory.
    """

    def __init__(self) -> None:
        self.left = TOTAL_LIMIT_BYTES

    def spend(self, size: int) -> None:
        """Take `size` bytes off what is left, refusing the export once it runs out."""
        if size > self.left:
            raise ValueError(
                f"Anki export too large: its files unpack past {TOTAL_LIMIT_BYTES} bytes together"
            )
        self.left -= size


def _member(bundle: zipfile.ZipFile, name: str, budget: _Budget, cap: int) -> bytes:
    """The member `name` inflated, a chunk at a time, stopped one byte past `cap`.

    Never `bundle.read`, and never trusting the size the zip states: a deflate
    bomb states what it likes, and only counting what comes out stops it.

    Raises:
        ValueError: zipfile cannot read the member, for each way it says so:
            a bad header or CRC, a stream cut short, an encryption or method it
            lacks, or bytes that deflate, lzma, bzip2 (as `OSError`) or zstd
            refuse, or a local header name flagged utf-8 that does not decode.
            `budget`'s own refusal passes through as it is.
    """
    out = bytearray()
    try:
        with bundle.open(name) as stream:
            while len(out) <= cap:
                chunk = stream.read(min(_CHUNK_BYTES, cap + 1 - len(out)))
                if not chunk:
                    break
                budget.spend(len(chunk))
                out += chunk
    except (
        zipfile.BadZipFile,
        EOFError,
        RuntimeError,
        NotImplementedError,
        OSError,
        zlib.error,
        lzma.LZMAError,
        zstd.ZstdError,
        # A local header flagged utf-8 whose name does not decode. `budget`'s
        # own ValueError is no UnicodeDecodeError, so it still passes.
        UnicodeDecodeError,
    ) as error:
        raise ValueError(f"unreadable Anki export: {name}: {error}") from error
    return bytes(out)


def _opened(data: bytes) -> zipfile.ZipFile:
    """`data` opened as a zip, its directory read.

    Raises:
        ValueError: a central entry flagged utf-8 holds a name that does not decode.
    """
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except UnicodeDecodeError as error:
        raise ValueError(f"unreadable Anki export: a member name is not utf-8: {error}") from error


def _count_members(data: bytes) -> None:
    """Refuse `data` past `MEMBER_COUNT_LIMIT` members before zipfile reads its directory.

    zipfile builds an object for every entry before anything can count them,
    and a hundred mebibytes of empty entries is some two million. The end
    record's count comes first, then the entries themselves up to the cap,
    since zipfile reads the directory by its size and a record may understate
    the count. Bytes that are no zip, or a directory that breaks off, are left
    for zipfile to refuse in its own words.
    """
    # `_EndRecData` is private, so typeshed leaves it out, but it has not
    # changed in decades; it finds the record behind a comment and resolves
    # zip64. Its fields 4, 5 and 9 are zipfile's `_ECD_ENTRIES_TOTAL`,
    # `_ECD_SIZE` and `_ECD_LOCATION`.
    end = zipfile._EndRecData(io.BytesIO(data))  # ty: ignore[unresolved-attribute]
    if end is None:
        return
    count, size, stop = end[4], end[5], end[9]
    too_many = f"Anki export too large: it holds more than {MEMBER_COUNT_LIMIT} files"
    if count > MEMBER_COUNT_LIMIT:
        raise ValueError(too_many)
    # Where zipfile starts too: the directory's size before the record, which
    # also allows for any bytes prepended to the zip. For zip64 the location
    # is already the zip64 record's, which `_EndRecData` moves it to.
    at = stop - size
    for _ in range(MEMBER_COUNT_LIMIT + 1):
        if at < 0 or at + 46 > stop or data[at : at + 4] != b"PK\x01\x02":
            return
        name, extra, comment = struct.unpack_from("<3H", data, at + 28)
        at += 46 + name + extra + comment
    raise ValueError(too_many)


def _unzstd(blob: bytes, budget: _Budget, cap: int) -> bytes:
    """Every frame of `blob` decompressed, stopped one byte past `cap` or what `budget` has left.

    A decompressor stops at the end of its frame and leaves the rest in
    `unused_data`, where `zstd.decompress` would go on, so each further frame
    takes a fresh one under what is left of the same cap.

    Raises:
        zstd.ZstdError: `blob` is not zstd, or a frame is cut short, which a
            decompressor given `max_length` reports by not reaching `eof`
            rather than by raising.
    """
    out = bytearray()
    while True:
        decompressor = zstd.ZstdDecompressor()
        piece = decompressor.decompress(blob, max_length=min(cap - len(out), budget.left) + 1)
        budget.spend(len(piece))
        out += piece
        if len(out) > cap:
            return bytes(out)
        if not decompressor.eof:
            raise zstd.ZstdError("the frame ends early")
        blob = decompressor.unused_data
        if not blob:
            return bytes(out)


def _capped(name: str, blob: bytes) -> bytes:
    """`blob` as it is, or refused when the member `name` unpacked past `MEMBER_LIMIT_BYTES`."""
    if len(blob) > MEMBER_LIMIT_BYTES:
        raise ValueError(f"Anki export too large: {name} unpacks past {MEMBER_LIMIT_BYTES} bytes")
    return blob


def _collection(bundle: zipfile.ZipFile, budget: _Budget) -> bytes:
    """The sqlite bytes of the newest collection the export holds."""
    held = set(bundle.namelist())
    member = next((name for name in COLLECTION_MEMBERS if name in held), None)
    if member is None:
        raise ValueError(f"no Anki collection in the export: {sorted(held)}")
    blob = _capped(member, _member(bundle, member, budget, MEMBER_LIMIT_BYTES))
    if member != ZSTD_MEMBER:
        return blob
    try:
        return _capped(member, _unzstd(blob, budget, MEMBER_LIMIT_BYTES))
    except zstd.ZstdError as error:
        raise ValueError(f"unreadable Anki export: {member} is not zstd: {error}") from error


def _media_index(bundle: zipfile.ZipFile, budget: _Budget) -> dict[str, str]:
    """Every media file the export lists, by the name a field gives it, against its zip member.

    The legacy map is JSON from member to name. The latest is Anki's
    `MediaEntries`, its entries numbered by position unless one carries the
    `legacy_zip_filename` of field 255.
    """
    if "media" not in bundle.namelist():
        return {}
    raw = _capped("media", _member(bundle, "media", budget, MEMBER_LIMIT_BYTES))
    latest = raw.startswith(ZSTD_MAGIC)
    if latest:
        # Apart from the parse below, whose `ValueError` would swallow a cap's.
        try:
            raw = _capped("media", _unzstd(raw, budget, MEMBER_LIMIT_BYTES))
        except zstd.ZstdError as error:
            raise ValueError(f"unreadable Anki export: bad media map ({error})") from error
    try:
        if not latest:
            return {name: member for member, name in json.loads(raw).items()}
        return media_map(raw)
    except (ValueError, AttributeError, TypeError) as error:
        raise ValueError(f"unreadable Anki export: bad media map ({error})") from error


def _media_file(
    bundle: zipfile.ZipFile, index: dict[str, str], name: str, budget: _Budget
) -> tuple[str, bytes] | None:
    """The file a field names as `name`, by its name in the vault and its bytes, or None.

    None for a file the vault would refuse as `store` would: a name that is not
    one plain file name the vault holds (hidden, or too long once its temp's
    fourteen bytes are added), a suffix it takes no image or sound under, a body over
    the cap or not what its suffix says. None too for one the zip lacks. What it
    reads counts against `budget` all the same, so many files each under the
    cap still refuse the export once together they pass `TOTAL_LIMIT_BYTES`.
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
    data = _member(bundle, member, budget, ASSET_LIMIT_BYTES)
    if data.startswith(ZSTD_MAGIC):
        try:
            # Capped, since the size the zip states is the compressed one.
            data = _unzstd(data, budget, ASSET_LIMIT_BYTES)
        except zstd.ZstdError:
            return None
    if len(data) > ASSET_LIMIT_BYTES or not fits(Path(name).suffix.lower(), data):
        return None
    return name, data
