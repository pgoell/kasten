"""The Claude Code skills in the vault, read and never written.

Serves `list_skills` and `read_skill`. Paths resolve inside the skills folder through
`resolve_folder_path`, so `..`, a hidden file and a link out stay refused. Nothing here
writes: a written skill is code the chat pane runs with every permission.
"""

from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend.frontmatter import description
from kasten_backend.vault import resolve_folder_path

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.config import Settings

SUFFIXES = (".md", ".sh", ".py", ".json", ".yaml", ".yml", ".txt")
"""What a skill folder holds that an agent may read: text, never a binary."""

MOST_BYTES = 256 * 1024
"""A skill file larger than this is refused rather than read."""

SKILL_MD = "SKILL.md"
"""The file that makes a folder a skill, as Claude Code spells it."""


class Skill(BaseModel):
    """One skill: its folder name, the description off its SKILL.md, and its files."""

    name: str
    description: str
    files: list[str]


class SkillRead(BaseModel):
    """One skill file. No sha: nothing can write it back."""

    path: str
    content: str


def _root(settings: Settings) -> Path | None:
    """The real skills folder, or None when it is missing or leads out of the vault.

    A link anywhere on the way is refused, not only one out of the vault: one to `.jj`
    would serve the jj repo, which the dotfile rule keeps from every other read.
    """
    base = settings.vault_path.resolve()
    folder = base / settings.skills_path
    if folder.resolve() != folder or not folder.is_dir() or not folder.is_relative_to(base):
        return None

    return folder


def _read(folder: Path, relative: str) -> SkillRead | None:
    """One file under `folder`, or None when refused or not text.

    A NUL marks a binary that happens to decode as UTF-8.
    """
    path = resolve_folder_path(folder, relative)
    if path is None or not path.is_file() or path.suffix.lower() not in SUFFIXES:
        return None

    # An unreadable file is absent, not an error: one of them would otherwise
    # take down every listing.
    try:
        if path.stat().st_size > MOST_BYTES:
            return None
        text = path.read_bytes().decode("utf-8")
    except OSError, UnicodeDecodeError:
        return None

    if "\0" in text:
        return None

    return SkillRead(path=path.relative_to(folder).as_posix(), content=text)


async def list_skills(settings: Settings) -> list[Skill]:
    """Every folder under the skills path holding a readable SKILL.md, with its files.

    Each file is read on the way, so the listing names only what a read hands out. A
    hidden part is dropped before anything is read.
    """
    folder = _root(settings)
    if folder is None:
        return []

    walked = (p.relative_to(folder) for p in folder.rglob("*"))
    read = {
        found.path: found
        for path in sorted(
            p.as_posix() for p in walked if not any(part.startswith(".") for part in p.parts)
        )
        if (found := _read(folder, path)) is not None
    }
    read = dict(sorted(read.items()))
    return [
        Skill(
            name=path.partition("/")[0],
            description=description(found.content),
            files=[other for other in read if other.startswith(path.partition("/")[0] + "/")],
        )
        for path, found in read.items()
        if path.count("/") == 1 and path.endswith(f"/{SKILL_MD}")
    ]


async def read_skill(settings: Settings, path: str) -> SkillRead | None:
    """One file of one skill, relative to the skills folder, or None.

    Every refusal reads as absent, as `read_note`'s does, so a probe learns nothing.
    """
    folder = _root(settings)
    return None if folder is None else _read(folder, path)
