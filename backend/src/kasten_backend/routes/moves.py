"""Routes that move, delete and restore notes and folders, and preview what a move rewrites."""

from datetime import datetime  # noqa: TC003  pydantic reads the annotation at runtime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import Settings, get_settings
from kasten_backend.folders import prune_empty_folders, rename_folder, rename_note
from kasten_backend.frontmatter import reserved, stamp
from kasten_backend.indexes import carries, drop_entries, rehome_entry
from kasten_backend.links import plan_move, relink_move
from kasten_backend.routes.notes import Note
from kasten_backend.trash import (
    Entry,
    list_trash,
    move_to_trash,
    resolve_entry,
    restore,
)
from kasten_backend.vault import (
    move_asset_beside,
    relative_path,
    resolve_folder,
    resolve_folder_path,
    resolve_note,
    resolve_path,
    write_note,
)

router = APIRouter()


class NoteMove(BaseModel):
    """Where a note should live from now on. Where it lives today comes from the URL."""

    path: str


class Folder(BaseModel):
    """One folder, as the vault spells it.

    No content beside the path. A folder is the prefix of the notes under it and
    holds nothing of its own, so there is nothing else to answer with.
    """

    path: str


class FolderMove(BaseModel):
    """Where a folder should live from now on, and every note under it with it."""

    path: str


class TrashEntry(BaseModel):
    """One deleted note or folder, waiting in the trash."""

    entry: str
    """Where it sits under `.trash`, which is the name a restore takes.

    Its own field rather than something the client builds out of the two below,
    because the spelling is the backend's: it is a path in the vault's own
    trash, and a client that assembled it would be a second copy of that rule.
    """

    path: str
    """Where it lived in the vault, and where a restore puts it back."""

    deleted: datetime
    """When it was deleted, UTC, off the entry's own name."""

    @classmethod
    def of(cls, found: Entry) -> TrashEntry:
        """Read one off what the trash answered with."""
        return cls(entry=found.entry, path=found.path, deleted=found.deleted)


class Restored(BaseModel):
    """Where a restored note or folder landed, which is where it was."""

    path: str


@router.patch("/api/files/{path:path}")
async def move_file(
    path: str, move: NoteMove, settings: Annotated[Settings, Depends(get_settings)]
) -> Note:
    """Give one note a new path, moving it between folders as well as renaming it.

    `PATCH` rather than a `/rename` route because the path is the note's
    identity: `POST` starts a note, `PUT` replaces its text, and this changes
    where it lives. A verb in the URL would be the same thing spelled as a
    remote procedure call.

    A missing source is a 404, matching the read and the write, so a note you
    cannot open stays a note you cannot move. The target names its refusal the
    way a create does, a 400 for a path the vault will not have and a 409 for
    one already taken, because the user is about to retype it and has to know
    which it was.

    The text comes back read off disk rather than carried over from the client.
    Both the URL and the query key change on a move, and seeding the new one
    from here is what stops a note edited outside kasten arriving stale on the
    other side.

    The books beside the note travel with it, or the pair stops being a pair.
    The answer says nothing about that, because there is nothing a client does
    differently: it asks `/api/books` about the path it moved the note to, the
    way it always has.
    """
    async with vault_write():
        note = resolve_note(settings.vault_path, path)
        if note is None:
            raise HTTPException(status_code=404, detail="No such note")

        target = resolve_path(settings.vault_path, move.path)
        if target is None:
            raise HTTPException(status_code=400, detail="The vault will not take that path")
        if target.exists():
            raise HTTPException(status_code=409, detail="A note is already there")

        source = relative_path(settings.vault_path, note)
        relative = relative_path(settings.vault_path, target)

        async with vault_change(settings.vault_path, relative):
            # Before the move, because a bare `[[borges]]` only names this note
            # while the note is still where the links were written to find it.
            # Inside the jj bracket, because the rewritten links are part of the
            # move rather than an edit that happened to follow it.
            await relink_move(settings.vault_path, source, relative, folder=False)
            rename_note(note, target)
            # A file exempt from the block because of what it was called is a
            # note again under any other name, so it is stamped where it lands.
            # Inside the bracket, so the rewrite is part of the move. The other
            # direction is not handled and must not be: a note renamed onto a
            # reserved name keeps the block it had, because deleting it would
            # delete an id and a creation date the note owns, and converting the
            # body is a job for a person.
            if reserved(source) and not reserved(relative):
                write_note(target, stamp(target.read_text(encoding="utf-8")))
            # After the note and before the prune, so a folder the pair has both
            # left is one the prune can take.
            move_asset_beside(note, target)
            # After the links, which is what points the old index's entry at
            # the new path, and before the prune, which would take an index
            # left holding nothing along with its folder.
            rehome_entry(settings.vault_path, source, relative)
            # A folder the move emptied is gone, and so is the line naming it.
            drop_entries(settings.vault_path, prune_empty_folders(settings.vault_path, note.parent))

    return Note(path=relative, content=target.read_text(encoding="utf-8"))


@router.patch("/api/folders/{path:path}")
async def move_folder(
    path: str, move: FolderMove, settings: Annotated[Settings, Depends(get_settings)]
) -> Folder:
    """Give one folder a new path, and every note under it a new path with it.

    Its own route rather than the one above, because a folder is not a note and
    `/api/files/inbox` cannot mean the folder on a `PATCH` and nothing at all on
    a `GET`. What the two share is the shape: the URL says where it lives now,
    the body where it should live from here on.

    The refusals are the note's, read for a folder. A source that is not a
    folder is a 404, a note at that path included, so the one way to move a note
    stays the route above. The target names its refusal, a 400 for a path the
    vault will not have and a 409 for one already taken, because the user is
    about to retype it.

    A target inside the source is a 400 too. A folder cannot hold itself, and
    `rename` raises on that rather than refusing, so it is caught here with the
    rest.

    No content comes back. The notes under the folder are at new paths now, but
    they are unchanged, and the client works out where they went from the folder
    path alone.
    """
    async with vault_write():
        folder = resolve_folder(settings.vault_path, path)
        if folder is None:
            raise HTTPException(status_code=404, detail="No such folder")

        target = resolve_folder_path(settings.vault_path, move.path)
        if target is None or target.is_relative_to(folder):
            raise HTTPException(status_code=400, detail="The vault will not take that path")
        if target.exists():
            raise HTTPException(status_code=409, detail="Something is already there")

        relative = relative_path(settings.vault_path, target)

        # The trailing slash is what tells one of these apart from a note's
        # change in `jj log`, where the two would otherwise read the same.
        async with vault_change(settings.vault_path, f"{relative}/"):
            # Before the move, the way a note's rewrite is, and for one reason
            # more: the notes holding these links are often the ones inside the
            # folder, and after the rename none of them is at the path the
            # rewrite would write to.
            source = relative_path(settings.vault_path, folder)
            await relink_move(settings.vault_path, source, relative, folder=True)
            rename_folder(folder, target)
            # Where a note's move does it, and for the same reasons.
            rehome_entry(settings.vault_path, source, relative)
            drop_entries(
                settings.vault_path, prune_empty_folders(settings.vault_path, folder.parent)
            )

    return Folder(path=relative)


class MovePreview(BaseModel):
    """What a move would rewrite, asked before it is made."""

    rewrites: list[str]
    """Every file whose text the move changes, by the path it has today, sorted."""


@router.get("/api/move-preview")
async def preview_move(
    source: str, target: str, settings: Annotated[Settings, Depends(get_settings)]
) -> MovePreview:
    """Which files moving `source` to `target` would rewrite, and nothing written.

    A `GET` beside the two `PATCH` routes rather than a flag on them, because
    it changes nothing and answers with something neither of them does. The
    tree asks it before a drop, so the confirm can say how far a move reaches.

    `source` is a note or a folder, whichever the vault holds there. Nothing
    there is a 404 and a target the vault will not take is a 400, the refusals
    the move itself would give. A target already taken is not refused: the
    move will say so, and the question here is only about links.
    """
    async with vault_write():
        note = resolve_note(settings.vault_path, source)
        found = note or resolve_folder(settings.vault_path, source)
        if found is None:
            raise HTTPException(status_code=404, detail="Nothing is there")

        resolve = resolve_path if note else resolve_folder_path
        landing = resolve(settings.vault_path, target)
        if landing is None or (note is None and landing.is_relative_to(found)):
            raise HTTPException(status_code=400, detail="The vault will not take that path")

        old = relative_path(settings.vault_path, found)
        new = relative_path(settings.vault_path, landing)
        rewrites = set(await plan_move(settings.vault_path, old, new, folder=note is None))
        index = carries(settings.vault_path, old, new)

    return MovePreview(rewrites=sorted(rewrites | ({index} if index else set())))


@router.delete("/api/files/{path:path}")
async def delete_file(
    path: str, settings: Annotated[Settings, Depends(get_settings)]
) -> TrashEntry:
    """Take one note out of the vault, and hold it in the trash.

    A `DELETE` that keeps the note is not a contradiction: what the vault holds
    is what these routes answer about, and the note stops being one of them the
    moment it moves. Nothing lists it, nothing searches it and no path reaches
    it, because everything here refuses a hidden folder.

    A missing note is a 404, matching the read, the write and the move, so a
    note you cannot open is a note you cannot delete.

    The links pointing at it are left alone. A `[[link]]` names a note rather
    than a place, the editor already draws one nothing answers to as missing,
    and rewriting the vault to say a note is gone would be the one edit a
    restore could not take back.
    """
    async with vault_write():
        note = resolve_note(settings.vault_path, path)
        if note is None:
            raise HTTPException(status_code=404, detail="No such note")

        relative = relative_path(settings.vault_path, note)

        return TrashEntry.of(await move_to_trash(settings.vault_path, note, relative))


@router.delete("/api/folders/{path:path}")
async def delete_folder(
    path: str, settings: Annotated[Settings, Depends(get_settings)]
) -> TrashEntry:
    """Take one folder out of the vault, and every note under it with it.

    Its own route rather than the one above, for the reason the folder's move
    has one: `/api/files/inbox` cannot mean the folder here and nothing at all
    on a `GET`. A source that is not a folder is a 404, a note at that path
    included, so the one way to delete a note stays the route above.

    One entry in the trash, not one per note. The folder went in one rename and
    it comes back in one, so the thing you get back is the folder you deleted
    rather than a list of notes to put back yourself.
    """
    async with vault_write():
        folder = resolve_folder(settings.vault_path, path)
        if folder is None:
            raise HTTPException(status_code=404, detail="No such folder")

        relative = relative_path(settings.vault_path, folder)

        return TrashEntry.of(await move_to_trash(settings.vault_path, folder, relative))


@router.get("/api/trash")
async def read_trash(settings: Annotated[Settings, Depends(get_settings)]) -> list[TrashEntry]:
    """Everything the trash is holding, newest first.

    Read off the names in `.trash` rather than out of a list somebody has to
    keep in step. The name of an entry says where it came from and when it
    went, which is the whole record, so a note moved out of the trash by hand
    stops being on this list by the same act.
    """
    return [TrashEntry.of(found) for found in list_trash(settings.vault_path)]


@router.patch("/api/trash/{entry:path}")
async def restore_entry(
    entry: str, settings: Annotated[Settings, Depends(get_settings)]
) -> Restored:
    """Put one entry back where it was deleted from.

    `PATCH`, and no body, for the reason a move is one: this changes where
    something lives, and where it should live is already written in the entry's
    own name. An entry the trash has not got is a 404, and a path something has
    taken since is a 409, which is the create's answer and the move's.
    """
    async with vault_write():
        found = resolve_entry(settings.vault_path, entry)
        if found is None:
            raise HTTPException(status_code=404, detail="No such entry")

        target = resolve_folder_path(settings.vault_path, found.path)
        if target is None:
            raise HTTPException(status_code=400, detail="The vault will not take that path")
        if target.exists():
            raise HTTPException(status_code=409, detail="Something is already there")

        await restore(settings.vault_path, found)

    return Restored(path=found.path)
