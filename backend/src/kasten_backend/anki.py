"""Reading an Anki `.apkg` export into decks of front-and-back cards.

The archive is a zip around sqlite. `anki_collection` renders each card, `anki_html`
turns fields into markdown, and a cloze type keeps its first two fields (#233).
Media becomes `![](path)` when the vault would take it, else it is dropped.
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

Recent exports hold several at once. The older ones are stubs, so an old Anki says so
rather than crashing. This order keeps the stub out.
"""

ZSTD_MEMBER = "collection.anki21b"
"""The collection member that is compressed rather than an sqlite file as it stands."""

ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
"""What a zstd frame starts with.

The latest export compresses its media map and media files, the legacy one neither.
"""

MEMBER_LIMIT_BYTES = 1024 * 1024 * 1024
"""The most one member may unpack to, through the zip and zstd both.

A gibibyte: uploads are capped at 100 MiB and text compresses about five times over, so a
real deck stays far under it and a bomb is stopped here.
"""

TOTAL_LIMIT_BYTES = 2 * 1024 * 1024 * 1024
"""The most every member read may unpack to together.

The import holds all of it in memory, so the sum needs a cap, not only each member.
"""

MEMBER_COUNT_LIMIT = 50_000
"""The most members an export may hold.

A big deck holds a member per image and sound, a few thousand. Fifty thousand is about two
KiB each, less than any picture worth carrying.
"""

_CHUNK_BYTES = 1024 * 1024
"""How much of a member `_member` reads at a time, so a cap is checked as it unpacks."""

MEDIA_SUFFIXES = (*IMAGE_SUFFIXES, *AUDIO_SUFFIXES)
"""What a field's image or sound may be to come through: an asset, and no book."""

_LINK_SAFE = "/;,@&=+$!*'"
"""What `media_path` leaves unescaped: `encodeURI`'s reserved set less `#` and `?`.

That is `encodePath` in `note-path.ts` less `:` and the parens. A `::` would split the card
line, and a lone paren would end the link early.
"""

_NAME_LIMIT_BYTES = 255
"""The longest file name a filesystem takes, which `vault.py` holds to as well."""


def media_path(folder: str, deck: str, name: str) -> str:
    """Where the file `name` of `deck` goes, vault-relative: a folder beside the deck's note."""
    return "/".join(part for part in (folder, f"{deck} media", name) if part)


def read_apkg(data: bytes, folder: str = "", *, carry: bool = False) -> list[Deck]:
    """Every deck `data` holds, sorted by name and without the empty ones.

    `folder` is where the deck notes go. Each card links the media it can carry under
    `media_path`, and `carry` keeps each card's `reviews`. A bad export raises `ValueError`.
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

    Both the inflated zip bytes and the zstd output count, since the import holds each.
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

    Never `bundle.read`: a deflate bomb states whatever size it likes, so only counting the
    output stops it. Each way zipfile fails becomes `ValueError`; `budget`'s refusal passes.
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
    """`data` opened as a zip, refused if a member name flagged utf-8 does not decode."""
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except UnicodeDecodeError as error:
        raise ValueError(f"unreadable Anki export: a member name is not utf-8: {error}") from error


def _count_members(data: bytes) -> None:
    """Refuse `data` past `MEMBER_COUNT_LIMIT` members before zipfile builds its directory.

    zipfile makes an object per entry, and a hundred mebibytes of empty entries is about two
    million. So this counts the entries itself, up to the cap, first.
    """
    # `_EndRecData` is private and missing from typeshed, but it is stable: it finds the
    # record and resolves zip64. Fields 4, 5 and 9 are the entry count, size and location.
    end = zipfile._EndRecData(io.BytesIO(data))  # ty: ignore[unresolved-attribute]
    if end is None:
        return
    count, size, stop = end[4], end[5], end[9]
    too_many = f"Anki export too large: it holds more than {MEMBER_COUNT_LIMIT} files"
    if count > MEMBER_COUNT_LIMIT:
        raise ValueError(too_many)
    # Where zipfile starts too, allowing for prepended bytes. For zip64, `_EndRecData` has
    # already moved the location to the zip64 record.
    at = stop - size
    for _ in range(MEMBER_COUNT_LIMIT + 1):
        if at < 0 or at + 46 > stop or data[at : at + 4] != b"PK\x01\x02":
            return
        name, extra, comment = struct.unpack_from("<3H", data, at + 28)
        at += 46 + name + extra + comment
    raise ValueError(too_many)


def _unzstd(blob: bytes, budget: _Budget, cap: int) -> bytes:
    """Every frame of `blob` decompressed, stopped one byte past `cap` or what `budget` has left.

    A decompressor stops at the end of each frame and leaves the rest in `unused_data`, so
    each further frame takes a fresh one. A frame cut short raises `zstd.ZstdError`.
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
    """The file a field names as `name`, by its vault name and bytes, or None.

    None for a file `store` would refuse, or for one the zip lacks. What it reads still
    counts against `budget`, so many small files can exhaust it.
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
