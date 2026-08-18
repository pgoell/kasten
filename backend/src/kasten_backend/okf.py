"""What Open Knowledge Format asks of the vault as a whole.

One field is the whole of what kasten adopts: every concept document says what
kind of thing it is. New notes get that from `stamp` on the way in, and the
notes already in the vault get it from the pass below, once, at startup.

The pass is not a `PUT` over every note and could not be. A save rewrites
`modified`, and a vault of five thousand notes would come out of it all dated
today, which is the one thing a notebook must never do to your own history.
"""

from pathlib import Path

from kasten_backend.change import vault_change, vault_write
from kasten_backend.frontmatter import reserved, with_type
from kasten_backend.guide import write_missing
from kasten_backend.vault import list_markdown_files, write_note

BACKFILL_LABEL = "type backfill"
"""What the pass calls its jj change, in the slot a note's path usually fills."""

READER_PATH = "99 Misc/01 Config/reading-this-vault.md"
"""Where the note that says how this vault's links resolve lives.

Outside `01 Agents/`, because this one is for whoever opens the bundle, and an
OKF consumer that has never heard of kasten is the reader it is written for.
"""

ONTOLOGY_PATH = "99 Misc/01 Config/01 Agents/Ontology.md"
"""Where the vault's own vocabulary lives, beside the guides an agent reads.

A note rather than a config file, so nothing validates a relation and an unknown
name works. The editor's completion reads this, and so does anyone with `cat`.
"""

INDEX_GUIDE_PATH = "99 Misc/01 Config/01 Agents/How-To-Index.md"
"""Where the shape of the two reserved files is written down, for whoever writes one.

Beside the format guides, because that is what it is. `reading-this-vault.md`
says these two carry no block, which is what a reader needs; this says what to
put in one, which is what a writer needs, and every agent in this vault is both.
"""

STARTUP_NOTES = {
    READER_PATH: (Path(__file__).parent / "reading-this-vault.md").read_text(encoding="utf-8"),
    ONTOLOGY_PATH: (Path(__file__).parent / "ontology.md").read_text(encoding="utf-8"),
    INDEX_GUIDE_PATH: (Path(__file__).parent / "how-to-index.md").read_text(encoding="utf-8"),
}
"""The notes the bundle cannot be read or written without, and the text each arrives as.

Read off the package the way the guides are. Markdown in a Python string is
markdown nobody can read in a diff.
"""


async def backfill(root: Path) -> list[str]:
    """Write `type` into every note in the vault that has none. Returns what changed.

    Every rewrite is worked out before anything is written, so a boot on a vault
    that needs nothing leaves no empty change behind. When there is something to
    write it is one change for the pass rather than one per note: a thousand
    untyped notes are one line in `jj log`, not a thousand.

    Reserved names are skipped, and the walk skips a hidden directory without
    entering it, so `.trash` and the jj repo beside the notes are untouched.
    """
    # The scan and the writes under one lock, so a note another writer touches
    # between the two is not rewritten from the copy this pass read.
    async with vault_write():
        pending = []
        for relative in list_markdown_files(root):
            if reserved(relative):
                continue

            note = root / relative
            # Read without translating the line endings, then put back the ones
            # the note had. `read_text` turns every CRLF into an LF and
            # `write_note` writes what it is handed, so a note written on
            # Windows would come out of this pass with every one of its lines
            # rewritten beside the one field it was here for.
            raw = note.read_text(encoding="utf-8", newline="")
            held = raw.replace("\r\n", "\n")
            typed = with_type(held)
            if typed == held:
                continue

            pending.append(
                (note, typed.replace("\n", "\r\n") if "\r\n" in raw else typed, relative)
            )

        if not pending:
            return []

        async with vault_change(root, BACKFILL_LABEL):
            for note, typed, _ in pending:
                write_note(note, typed)

    return [relative for _, _, relative in pending]


async def prepare(root: Path) -> None:
    """Give the vault what OKF needs: the notes it cannot be read without, then its types.

    The backfill runs last, and for one reason: so it sees a vault that is
    finished being written to. It is not what types the startup notes. Each of
    those opens with its own block saying what it is, and `write_missing` hands
    that text to `stamp`, which leaves a type already there alone.

    A startup note is a note like any other after it arrives, so one a reader has
    edited down to untyped text gets `type: Note` on the next boot, exactly as
    every other untyped note does. No list of paths the pass skips: that would be
    a rule about paths, and wrong the first time one moves.
    """
    await write_missing(root, STARTUP_NOTES)
    await backfill(root)


if __name__ == "__main__":
    # The one implementation, reached from a terminal. A second one written here
    # over the same rules would be a second set of rules. The vault is an
    # argument rather than a setting, so this reaches any vault: the dev one by
    # default, a container's by path.
    import asyncio
    import sys

    _, *given = sys.argv
    if len(given) != 1:
        sys.exit("usage: python -m kasten_backend.okf <vault>")

    root = Path(given[0])
    # A missing directory reads as an empty vault everywhere else, which is what
    # lets a fresh checkout serve. Here it would mean a typo'd path printing
    # nothing and exiting zero, which reads exactly like a pass with nothing to do.
    if not root.is_dir():
        sys.exit(f"No vault at {root}")

    for changed in asyncio.run(backfill(root)):
        print(changed)
