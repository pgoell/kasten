"""The notes that tell an agent how this vault's own formats are written.

Every vault gets them, written at startup when it holds none, because the agents
that read them do not all live in the app: one in a terminal pane and one on
your laptop both find them by opening the note. A key press could not write
them, since the agent outside the app never presses one.

They are notes like any other after that. Edit one, move it, delete it; a
deleted one comes back the next time the backend starts, which is the same
bargain the saved views note makes.

Two of them now. A todo is a line and an exam is a note, and neither format is
guessable from the other, so each gets the page it needs rather than one page
trying to be both.
"""

from pathlib import Path

from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import DEFAULTS, Settings, get_settings
from kasten_backend.frontmatter import stamp
from kasten_backend.vault import create_note, resolve_path

TODO_GUIDE = "01 Agents/How-To-TODO.md"
"""Where the todo guide lives inside `KASTEN_CONFIG_PATH`, beside the saved views."""

EXAM_GUIDE = "01 Agents/How-To-Exam.md"
"""Where the exam guide lives inside `KASTEN_CONFIG_PATH`, beside the one above."""

GUIDE_PATH = f"{DEFAULTS.config_path}/{TODO_GUIDE}"
"""Where the todo guide lands in a vault on the default layout."""

EXAM_GUIDE_PATH = f"{DEFAULTS.config_path}/{EXAM_GUIDE}"
"""Where the exam guide lands in a vault on the default layout."""

# Read off the package once rather than spelled in Python. Markdown in a Python
# string is markdown nobody can read in a diff, and both of these are the length
# of a documentation page.
GUIDES = {
    TODO_GUIDE: (Path(__file__).parent / "how-to-todo.md").read_text(encoding="utf-8"),
    EXAM_GUIDE: (Path(__file__).parent / "how-to-exam.md").read_text(encoding="utf-8"),
}
"""Each guide by its place inside the config folder, as a template `Settings.fill` reads."""


def placed(settings: Settings, notes: dict[str, str]) -> dict[str, str]:
    """`notes` moved under the config folder, each text naming this vault's folders."""
    return {f"{settings.config_path}/{name}": settings.fill(text) for name, text in notes.items()}


async def write_guide(root: Path) -> None:
    """Write the guides into `root`, skipping each one the vault already holds.

    The layout comes off the settings rather than an argument, the way the
    lifespan that calls this reads its own: there is no request to inject from.
    """
    await write_missing(root, placed(get_settings(), GUIDES))


async def write_missing(root: Path, notes: dict[str, str]) -> None:
    """Write each of `notes` the vault does not hold, one jj change each.

    Each is bracketed by a jj change the way every other write is, so the note
    arrives in the history rather than as a surprise in somebody's next diff.
    One at a time rather than one change for all, so a vault that has kept one
    and deleted another gets a change naming what actually came back.

    The text goes through `stamp`, which fills in what the block is missing and
    leaves what it carries alone, so a startup note that opens with its own
    `type` keeps it rather than being called a `Note`.
    """
    for path, text in notes.items():
        # The lock is taken per note rather than for the loop, so the guide the
        # vault is missing arrives in its own change the way it always has.
        async with vault_write():
            note = resolve_path(root, path)
            if note is None or note.exists():
                continue

            async with vault_change(root, path):
                create_note(note, stamp(text))
