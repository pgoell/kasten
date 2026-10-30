"""The notes that tell an agent how this vault's own formats are written.

Written at startup when a vault has none, since agents outside the app cannot press a key to
write them. They are ordinary notes after that: a deleted one returns at the next start.
"""

from pathlib import Path

from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import DEFAULTS, Settings, get_settings
from kasten_backend.folders import create_note
from kasten_backend.frontmatter import stamp
from kasten_backend.vault import resolve_path

TODO_GUIDE = "01 Agents/How-To-TODO.md"
"""Where the todo guide lives inside `KASTEN_CONFIG_PATH`, beside the saved views."""

EXAM_GUIDE = "01 Agents/How-To-Exam.md"
"""Where the exam guide lives inside `KASTEN_CONFIG_PATH`, beside the one above."""

GUIDE_PATH = f"{DEFAULTS.config_path}/{TODO_GUIDE}"
"""Where the todo guide lands in a vault on the default layout."""

EXAM_GUIDE_PATH = f"{DEFAULTS.config_path}/{EXAM_GUIDE}"
"""Where the exam guide lands in a vault on the default layout."""

# Read off the package, not spelled in Python: markdown in a string is unreadable in a diff,
# and both guides run to the length of a documentation page.
GUIDES = {
    TODO_GUIDE: (Path(__file__).parent / "guides" / "how-to-todo.md").read_text(encoding="utf-8"),
    EXAM_GUIDE: (Path(__file__).parent / "guides" / "how-to-exam.md").read_text(encoding="utf-8"),
}
"""Each guide by its place inside the config folder, as a template `Settings.fill` reads."""


def placed(settings: Settings, notes: dict[str, str]) -> dict[str, str]:
    """`notes` moved under the config folder, each text naming this vault's folders."""
    return {f"{settings.config_path}/{name}": settings.fill(text) for name, text in notes.items()}


async def write_guide(root: Path) -> None:
    """Write the guides into `root`, skipping each one the vault already holds.

    The layout comes from the settings: the lifespan that calls this has no request to inject from.
    """
    await write_missing(root, placed(get_settings(), GUIDES))


async def write_missing(root: Path, notes: dict[str, str]) -> None:
    """Write each of `notes` the vault does not hold, one jj change each.

    Each change is bracketed like every other write. One at a time, so a change names what came
    back. `stamp` fills what the block lacks and keeps what it carries.
    """
    for path, text in notes.items():
        # Locked per note, so each guide the vault is missing lands in its own change.
        async with vault_write():
            note = resolve_path(root, path)
            if note is None or note.exists():
                continue

            async with vault_change(root, path):
                create_note(note, stamp(text))
