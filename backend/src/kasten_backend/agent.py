"""What a token holder may do to the vault. No HTTP, no MCP, no auth.

Two surfaces call these: the `/agent/` routes and the MCP tools. One
implementation, so there is one path validator, one write bracket and one set of
rules about what an agent may do, rather than two that drift.

Every path argument goes through the resolvers in `vault.py`, so the boundary
that keeps a caller inside the vault is the existing one rather than a second
copy of it. Each function takes a `Settings` rather than a bare path, because
the archive folder is a setting and a capability that hardcoded `98 Archive`
would break the moment a vault filed things differently.

Deliberately five things and not the twenty-four `/api/*` serves. There is no
delete, no move and no folder operation: a move rewrites wikilinks across the
whole vault, and getting that wrong from outside the box is a vault-wide edit.
The shell container keeps the knife.
"""

import hashlib
from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend.search import search_vault
from kasten_backend.vault import (
    list_markdown_files,
    relative_path,
    resolve_folder,
    resolve_note,
)

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.config import Settings


class NoteRead(BaseModel):
    """One note, and the digest a conditional write presents back."""

    path: str
    content: str
    sha: str


class Hit(BaseModel):
    """One matching line: where it lives, which line it is, and what it says.

    Its own model rather than `main.SearchHit`, because nothing here may import
    from `main.py`: that would point the dependency at the surface instead of
    away from it, and the MCP tools import this module too.
    """

    path: str
    line: int
    text: str


def digest(content: bytes) -> str:
    """The SHA-256 hex of the bytes on disk, which is what `sha` always means here."""
    return hashlib.sha256(content).hexdigest()


def _read(root: Path, note: Path) -> NoteRead:
    """One note off disk, byte for byte.

    Read as bytes and decoded rather than through `vault.read_note`, which is
    `read_text` and turns every CRLF into an LF. A translated read would hand
    back a `content` whose digest is not the `sha` beside it, and a round trip
    would rewrite every line of a note written on Windows.
    """
    raw = note.read_bytes()

    return NoteRead(path=relative_path(root, note), content=raw.decode("utf-8"), sha=digest(raw))


async def read_note(settings: Settings, path: str) -> NoteRead | None:
    """One note out of the vault, or None when the vault holds no such note.

    Every refusal reads as absent, the way `vault.read_note`'s does: telling a
    typo apart from an attempt to climb out is worth nothing to the caller and
    something to everyone else.
    """
    note = resolve_note(settings.vault_path, path)
    if note is None:
        return None

    return _read(settings.vault_path, note)


async def list_notes(settings: Settings, folder: str = "") -> list[str]:
    """Every note in the vault, or in one folder of it, as sorted relative paths.

    `""` is an explicit sentinel for the whole vault and does not go through the
    folder resolver, which refuses the vault root by design. The root case
    filters the listing by prefix instead.

    A folder outside the vault is an empty list rather than a refusal, matching
    how every other escape in `vault.py` reads as absent.
    """
    notes = list_markdown_files(settings.vault_path)
    if not folder:
        return notes

    found = resolve_folder(settings.vault_path, folder)
    if found is None:
        return []

    prefix = f"{relative_path(settings.vault_path, found)}/"

    return [note for note in notes if note.startswith(prefix)]


async def search_notes(settings: Settings, query: str, archive: bool = False) -> list[Hit]:
    """Every line in the vault holding `query`, ignoring case, up to the same cap.

    The archive folder is walked past unless it is asked for, and its name comes
    off the settings rather than a literal `98 Archive`, which is one vault's
    filing convention and not kasten's.
    """
    skip = None if archive else settings.archive_path
    hits = await search_vault(settings.vault_path, query, skip)

    return [Hit(path=hit.path, line=hit.line, text=hit.text) for hit in hits]
