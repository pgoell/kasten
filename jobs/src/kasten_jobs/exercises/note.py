"""One exercise as the note the import writes, and the file name that note takes."""

import json
import re
from dataclasses import dataclass, field

MUSCLES = (
    "chest",
    "front-deltoids",
    "back-deltoids",
    "biceps",
    "triceps",
    "forearm",
    "abs",
    "obliques",
    "trapezius",
    "upper-back",
    "lower-back",
    "gluteal",
    "abductors",
    "adductor",
    "quadriceps",
    "hamstring",
    "calves",
    "neck",
)
"""The muscle groups a note may name: the body model's keys that part 7 paints (#1721)."""

KINDS = ("strength", "cardio", "mobility", "test")
COUNTS = ("weight-reps", "reps", "time")

_UNSAFE = re.compile(r'[*?"<>#^\[\]]')
_SPLIT = re.compile(r"\s*[/\\|:]\s*")


@dataclass(frozen=True)
class Exercise:
    """What a note says about one exercise. `credit` is the italic source line under the cues."""

    name: str
    kind: str
    counts: str
    source: str
    credit: str
    aliases: tuple[str, ...] = ()
    muscles_primary: tuple[str, ...] = ()
    muscles_secondary: tuple[str, ...] = ()
    equipment: tuple[str, ...] = ()
    cues: tuple[str, ...] = ()
    video: str = ""
    extra: dict[str, str] = field(default_factory=dict)


def file_name(name: str) -> str:
    """The name as a note's file name: no character a wikilink or a file system stumbles on."""
    spaced = _SPLIT.sub(" - ", _UNSAFE.sub("", name))
    return re.sub(r"\s+", " ", spaced).strip(" .-")[:120]


def _value(value: str | tuple[str, ...]) -> str:
    if isinstance(value, tuple):
        return "[" + ", ".join(_scalar(v) for v in value) + "]"
    return _scalar(value)


def _scalar(text: str) -> str:
    # A JSON string is a YAML double-quoted one, and kasten drops the quotes on read.
    if text == "" or re.fullmatch(r"[\w .()+\-äöüÄÖÜß]+", text):
        return text
    return json.dumps(text, ensure_ascii=False)


def render(exercise: Exercise) -> str:
    """The note: frontmatter, title, cues, credit and an empty `## Meine Notizen`."""
    fields: list[tuple[str, str | tuple[str, ...]]] = [
        ("type", "Reference"),
        ("kind", exercise.kind),
        ("aliases", exercise.aliases),
        ("muscles_primary", exercise.muscles_primary),
        ("muscles_secondary", exercise.muscles_secondary),
        ("equipment", exercise.equipment),
        ("counts", exercise.counts),
        ("source", exercise.source),
        *exercise.extra.items(),
        ("video", exercise.video),
    ]
    head = "\n".join(f"{key}: {_value(value)}".rstrip() for key, value in fields)
    cues = "\n".join(exercise.cues) if exercise.cues else "Die Quelle gibt keine Hinweise."
    return (
        f"---\n{head}\n---\n\n# {exercise.name}\n\n{cues}\n\n"
        f"*{exercise.credit}*\n\n## Meine Notizen\n"
    )
