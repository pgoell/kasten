"""The exercise notes: every note whose frontmatter `kind` is strength, cardio, mobility or test.

`docs/reference/training/exercise-import.md` gives the fields; the session screen picks from these.
"""

from pathlib import Path, PurePosixPath

from pydantic import BaseModel

from kasten_backend import frontmatter
from kasten_backend.search import skipped
from kasten_backend.vault import note_facts

KINDS = frozenset({"strength", "cardio", "mobility", "test"})
COUNTS = frozenset({"weight-reps", "reps", "time"})


class Exercise(BaseModel):
    """One exercise note: its name is the file name a `[[link]]` takes."""

    path: str
    name: str
    kind: str
    counts: str
    aliases: list[str]
    muscles_primary: list[str]
    muscles_secondary: list[str]
    equipment: list[str]


def _counts(kind: str, written: str | None) -> str:
    if written in COUNTS:
        return written
    return "time" if kind in {"cardio", "mobility"} else "weight-reps"


def _parse(path: str, raw: bytes) -> Exercise | None:
    if not raw.startswith(b"---"):
        return None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    kind = (frontmatter.field(text, "kind") or "").lower()
    if kind not in KINDS:
        return None
    return Exercise(
        path=path,
        name=PurePosixPath(path).stem,
        kind=kind,
        counts=_counts(kind, frontmatter.field(text, "counts")),
        aliases=frontmatter.aliases(text),
        muscles_primary=frontmatter.list_field(text, "muscles_primary"),
        muscles_secondary=frontmatter.list_field(text, "muscles_secondary"),
        equipment=frontmatter.list_field(text, "equipment"),
    )


def exercises(root: Path, skip: str | None = None) -> list[Exercise]:
    """Every exercise note outside the `skip` folder, by name."""
    held = note_facts(root, "exercise", _parse, None)
    found = [e for path, e in held.items() if e is not None and not skipped(path, skip)]
    return sorted(found, key=lambda e: e.name.lower())
