"""What Open Knowledge Format asks of the vault as a whole.

The one field kasten adopts is `type`: `stamp` sets it on new notes, and the pass below
sets it on old ones once, at startup. It is not a `PUT` over every note, since a save
rewrites `modified` and every note would come out dated today.
"""

from pathlib import Path

from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import DEFAULTS, get_settings
from kasten_backend.frontmatter import reserved, with_type
from kasten_backend.guide import placed, write_missing
from kasten_backend.vault import list_markdown_files, write_note

BACKFILL_LABEL = "type backfill"
"""What the pass calls its jj change, in the slot a note's path usually fills."""

READER = "reading-this-vault.md"
"""Where the note that says how this vault's links resolve lives, in the config folder.

Outside `01 Agents/`: it is written for a reader who has never heard of kasten.
"""

ONTOLOGY = "01 Agents/Ontology.md"
"""Where the vault's own vocabulary lives, beside the guides an agent reads.

A note, not a config file, so nothing validates a relation and an unknown name works.
"""

INDEX_GUIDE = "01 Agents/How-To-Index.md"
"""Where the shape of the two reserved files is written down, for whoever writes one.

`reading-this-vault.md` says these carry no block; this says what goes in one.
"""

# Where the three land on the default layout, `KASTEN_CONFIG_PATH` unset.
READER_PATH = f"{DEFAULTS.config_path}/{READER}"
ONTOLOGY_PATH = f"{DEFAULTS.config_path}/{ONTOLOGY}"
INDEX_GUIDE_PATH = f"{DEFAULTS.config_path}/{INDEX_GUIDE}"

STARTUP_NOTES = {
    READER: (Path(__file__).parent / "reading-this-vault.md").read_text(encoding="utf-8"),
    ONTOLOGY: (Path(__file__).parent / "ontology.md").read_text(encoding="utf-8"),
    INDEX_GUIDE: (Path(__file__).parent / "guides" / "how-to-index.md").read_text(encoding="utf-8"),
}
"""The notes the bundle cannot be read or written without, and the text each arrives as.

Read off the package, not pasted in: Markdown in a Python string is unreadable in a diff.
"""


async def backfill(root: Path) -> list[str]:
    """Write `type` into every note that has none. Returns the paths that changed.

    Rewrites are worked out before any is written, so a vault that needs nothing leaves no
    empty jj change. The pass is one change, not one per note.
    """
    # The scan and the writes under one lock, so a note another writer touches
    # between the two is not rewritten from the copy this pass read.
    async with vault_write():
        pending = []
        for relative in list_markdown_files(root):
            if reserved(relative):
                continue

            note = root / relative
            # `write_note` puts back the CRLF that `read_text` takes out, so a
            # note written on Windows keeps its line endings.
            held = note.read_text(encoding="utf-8")
            typed = with_type(held)
            if typed == held:
                continue

            pending.append((note, typed, relative))

        if not pending:
            return []

        async with vault_change(root, BACKFILL_LABEL):
            for note, typed, _ in pending:
                write_note(note, typed)

    return [relative for _, _, relative in pending]


async def prepare(root: Path) -> None:
    """Give the vault what OKF needs: the notes it cannot be read without, then its types.

    The backfill runs last, so it sees a vault that has stopped being written to.
    `KASTEN_TYPE_BACKFILL=false` skips it, for a vault kept by another tool.
    """
    settings = get_settings()
    await write_missing(root, placed(settings, STARTUP_NOTES))
    if settings.type_backfill:
        await backfill(root)


if __name__ == "__main__":
    # The one implementation, reached from a terminal, so the rules live in one place.
    # The vault is an argument, so this reaches any vault, not only the dev one.
    import asyncio
    import sys

    _, *given = sys.argv
    if len(given) != 1:
        sys.exit("usage: python -m kasten_backend.okf <vault>")

    root = Path(given[0])
    # A missing directory reads as an empty vault everywhere else. Here it would print
    # nothing and exit zero, which looks like a pass with nothing to do.
    if not root.is_dir():
        sys.exit(f"No vault at {root}")

    for changed in asyncio.run(backfill(root)):
        print(changed)
