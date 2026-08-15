"""What Open Knowledge Format asks of the vault as a whole.

One field is the whole of what kasten adopts: every concept document says what
kind of thing it is. New notes get that from `stamp` on the way in, and the
notes already in the vault get it from the pass below, once, at startup.

The pass is not a `PUT` over every note and could not be. A save rewrites
`modified`, and a vault of five thousand notes would come out of it all dated
today, which is the one thing a notebook must never do to your own history.
"""

from typing import TYPE_CHECKING

from kasten_backend.frontmatter import reserved, with_type
from kasten_backend.vault import list_markdown_files, write_note
from kasten_backend.vcs import begin_change, snapshot

if TYPE_CHECKING:
    from pathlib import Path

BACKFILL_LABEL = "type backfill"
"""What the pass calls its jj change, in the slot a note's path usually fills."""


async def backfill(root: Path) -> list[str]:
    """Write `type` into every note in the vault that has none. Returns what changed.

    Every rewrite is worked out before anything is written, so a boot on a vault
    that needs nothing leaves no empty change behind. When there is something to
    write it is one change for the pass rather than one per note: a thousand
    untyped notes are one line in `jj log`, not a thousand.

    Reserved names are skipped, and the walk skips a hidden directory without
    entering it, so `.trash` and the jj repo beside the notes are untouched.
    """
    pending = []
    for relative in list_markdown_files(root):
        if reserved(relative):
            continue

        note = root / relative
        held = note.read_text(encoding="utf-8")
        typed = with_type(held)
        if typed != held:
            pending.append((note, typed, relative))

    if not pending:
        return []

    await begin_change(root, BACKFILL_LABEL)
    for note, typed, _ in pending:
        write_note(note, typed)
    await snapshot(root)

    return [relative for _, _, relative in pending]
