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

SKILLS = {
    "meal-planner/SKILL.md": (Path(__file__).parent / "guides" / "meal-planner.md").read_text(
        encoding="utf-8"
    ),
}
"""Each skill kasten ships by its place inside the skills folder, written raw: no stamp."""


def placed(settings: Settings, notes: dict[str, str]) -> dict[str, str]:
    """`notes` moved under the config folder, each text naming this vault's folders."""
    return {f"{settings.config_path}/{name}": settings.fill(text) for name, text in notes.items()}


async def write_guide(root: Path) -> None:
    """Write the guides into `root`, skipping each one the vault already holds.

    The layout comes from the settings: the lifespan that calls this has no request to inject from.
    """
    settings = get_settings()
    await write_missing(root, placed(settings, GUIDES))
    await write_skills(root, settings)


async def write_skills(root: Path, settings: Settings) -> None:
    """Write each of `SKILLS` the skills folder lacks, so the chat pane can run it.

    A skills folder that is a link, or leads out of the vault, gets nothing, as `skills.py`
    reads none from it. The text is kasten's own, so no caller ever chooses what lands here.
    """
    for name, text in SKILLS.items():
        relative = f"{settings.skills_path}/{name}"
        async with vault_write():
            path = _missing(root, relative)
            if path is None:
                continue
            async with vault_change(root, relative):
                _place(path, settings.fill(text))


def _missing(root: Path, relative: str) -> Path | None:
    """Where `relative` goes when the vault lacks it, with no link on the way and inside `root`."""
    base = root.resolve()
    path = base / relative
    # A dangling link counts as missing to `exists()`, so each step is asked for a link itself.
    steps = [up for up in (path, *path.parents) if up.is_relative_to(base) and up != base]
    if not path.is_relative_to(base) or any(up.is_symlink() for up in steps):
        return None
    folders = steps[1:]
    # With no link on the way, a path that resolves elsewhere holds a `..`.
    if path.resolve() != path or path.exists():
        return None
    if any(up.exists() and not up.is_dir() for up in folders):
        return None
    return path


def _place(path: Path, text: str) -> None:
    """Write `path` through a hidden temp, making the folders on the way."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


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
