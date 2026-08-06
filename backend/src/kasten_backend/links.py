"""Pointing `[[wikilinks]]` at a note that has moved.

A link names a note rather than a place, so a bare `[[borges]]` follows the note
between folders on its own and there is nothing here for it to answer. A link
that spelled the path out does not follow, and a rename that changed the note's
name breaks both. This is what keeps the vault's links pointing where they were
written to point.

The rule a target is read by is the frontend's, in `frontend/src/lib/wikilink.ts`,
and the two have to agree: the note `gf` opens is the note a rename here follows.
Two copies of one rule is the cost of the editor resolving a link without asking
the server, and the tests on both sides describe the same three cases.
"""

import re
from typing import TYPE_CHECKING

from kasten_backend.search import notes_holding
from kasten_backend.vault import list_markdown_files, write_note

if TYPE_CHECKING:
    from pathlib import Path

SUFFIX = ".md"

WIKILINK = re.compile(r"\[\[([^\[\]\n]+)\]\]")
"""One `[[link]]`, spelled the way the editor's parser spells it.

A bracket or a line break inside means the `[[` opened nothing: a link names one
note, and it names it on one line. A target of only spaces is refused below,
where the text is in hand, rather than by a longer pattern here.
"""


def link_path(target: str, paths: list[str]) -> str:
    """The vault path `[[target]]` names, whether or not a note is there.

    A target with a slash in it is a path and is taken at its word. A bare name
    is looked for anywhere in the vault, ignoring case, so `[[borges]]` names
    `reading/borges.md` from any note. `paths` arrives sorted, so a note of that
    name at the vault root wins over one in a folder.
    """
    typed = target.strip()
    path = typed if typed.endswith(SUFFIX) else f"{typed}{SUFFIX}"
    if path in paths or "/" in path:
        return path

    name = path.lower()
    return next((other for other in paths if other.rsplit("/", 1)[-1].lower() == name), path)


def _name(path: str) -> str:
    """The note's name: the last segment, without the suffix."""
    return path.rsplit("/", 1)[-1][: -len(SUFFIX)]


def _respell(target: str, new: str) -> str:
    """`target` written for a note now at `new`, keeping the spelling it had.

    A path stays a path and a name stays a name, which is what leaves
    `[[borges]]` alone when only the folder changed. The `.md` goes either way:
    a link is read the same with or without it, and one spelling is enough.
    """
    stem = new[: -len(SUFFIX)]
    return stem if "/" in target.strip() else stem.rsplit("/", 1)[-1]


def relink(text: str, moves: dict[str, str], paths: list[str]) -> str:
    """`text` with every link naming a note in `moves` naming where it lands.

    A mapping rather than one pair, because a folder's move is one rewrite over
    many notes. Doing it as one pass per note moved would read the vault once
    per note in the subtree, and a link would be resolved against a listing that
    a previous pass had already made wrong.
    """

    def rewrite(match: re.Match[str]) -> str:
        target = match.group(1)
        if not target.strip():
            return match.group(0)

        new = moves.get(link_path(target, paths))
        if new is None:
            return match.group(0)
        return f"[[{_respell(target, new)}]]"

    return WIKILINK.sub(rewrite, text)


def _rewrite(root: Path, moves: dict[str, str], candidates: list[str], paths: list[str]) -> None:
    """Apply `moves` to `candidates`, writing only the notes that changed.

    `candidates` is rg's answer rather than the whole vault, for the reason
    search uses rg: a scan written here would read every note on every move and
    hold the event loop for all of it. It has to be a superset of the notes
    holding a link this rewrites, or the move leaves a link behind, and each
    caller below says why its own is.

    `paths` is the full listing all the same, because resolving a bare name
    needs it. Handed in rather than read here: it is the most expensive thing on
    this path, and the folder caller has already read it to work out what moved.
    """
    base = root.resolve()

    for relative in candidates:
        note = base / relative
        text = note.read_text(encoding="utf-8")
        rewritten = relink(text, moves, paths)
        if rewritten != text:
            write_note(note, rewritten)


async def relink_note_move(root: Path, old: str, new: str) -> None:
    """Point every link in the vault that named the note at `old` at `new`.

    Call this before the note is moved, not after. A bare name is resolved
    against the listing, and it only names the note while the note is still at
    the old path, so the listing this reads has to be the one the links were
    written under. The note being moved is read like any other, which is what
    carries its links to itself along with it.

    The note's own name is what narrows the read, because every link to it
    carries that name: a bare `[[borges]]` is the name, and a path
    `[[reading/borges]]` ends in it. The name matches far more than it rewrites,
    every mention of it in prose included, and `relink` is what tells those out.
    """
    _rewrite(root, {old: new}, await notes_holding(root, _name(old)), list_markdown_files(root))


async def relink_folder_move(root: Path, old: str, new: str) -> None:
    """Point every link naming a note under folder `old` at where it lands.

    A folder move is every note under it moving at once, so the mapping is built
    from the listing rather than given. The trailing slash is what keeps
    `readings.md` out of a move of `reading/`: a folder is a whole path segment,
    and a prefix match without it would take the notes whose name merely starts
    the same way.

    That same slash is what narrows the read, and here it misses nothing rather
    than merely matching too much. A bare name comes through a folder move
    unchanged, the note's name being unchanged, so the only link this rewrites
    is one that spelled the path out, and one that spelled it out holds the old
    folder's path in full.

    Before the move, for the reason a note's is. The notes holding the links are
    often the ones inside the folder, and after the rename none of them is at
    the path this would write to.
    """
    paths = list_markdown_files(root)
    prefix = f"{old}/"
    moves = {path: f"{new}/{path[len(prefix) :]}" for path in paths if path.startswith(prefix)}
    _rewrite(root, moves, await notes_holding(root, prefix), paths)
