"""The Claude Code skills in the vault, read and never written.

The ninth and tenth agent capabilities, `list_skills` and `read_skill`. Kept out
of `agent.py` and `vault.py` because nothing else needs what is here: one
folder, its suffixes, its cap and the rule that a file listed is a file a read
hands out.

The skills folder is the one hidden path a token holder reaches, and only as
the fixed prefix from the setting. The caller's path is resolved with that
folder as its base through `_resolve_inside`, the rule every note goes through,
so `..` cannot climb to the rest of `.claude`, a hidden file inside a skill
stays hidden and a link out is refused. Nothing here writes: a written skill is
code the chat pane runs with every permission, which is the danger reading
alone does not carry.
"""

from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend.frontmatter import description
from kasten_backend.vault import _list_files, _resolve_inside

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

    A `.claude` that is a link out of the vault resolves outside it and is
    refused, so the listing is empty rather than a walk of somewhere else.
    """
    base = settings.vault_path.resolve()
    folder = (base / settings.skills_path).resolve()
    if not folder.is_dir() or not folder.is_relative_to(base):
        return None

    return folder


def _read(folder: Path, relative: str) -> SkillRead | None:
    """One file under `folder`, or None when refused or not text.

    Read as bytes and decoded, so a file that is not UTF-8 is refused rather than
    raised on, and a NUL marks a binary that happens to decode.
    """
    path = _resolve_inside(folder, relative)
    if path is None or not path.is_file() or path.suffix.lower() not in SUFFIXES:
        return None

    if path.stat().st_size > MOST_BYTES:
        return None

    try:
        text = path.read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        return None

    if "\0" in text:
        return None

    return SkillRead(path=path.relative_to(folder).as_posix(), content=text)


async def list_skills(settings: Settings) -> list[Skill]:
    """Every folder under the skills path holding a readable SKILL.md, with its files.

    Each file is read on the way, because the walk lists a linked file by its
    name: a link out, a file over the cap or a binary would otherwise be named
    and then refused.
    """
    folder = _root(settings)
    if folder is None:
        return []

    read = {
        path: found
        for path in _list_files(folder, SUFFIXES, ignore_case=True)
        if (found := _read(folder, path)) is not None
    }
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

    Every refusal reads as absent, the way `read_note`'s does: a probe learns
    nothing about what is there.
    """
    folder = _root(settings)
    return None if folder is None else _read(folder, path)
