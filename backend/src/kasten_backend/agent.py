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

from kasten_backend.vault import relative_path, resolve_note

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.config import Settings


class NoteRead(BaseModel):
    """One note, and the digest a conditional write presents back."""

    path: str
    content: str
    sha: str


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
