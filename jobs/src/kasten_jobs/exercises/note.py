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

REGIONS = {
    "chest": "Brust",
    "upper-back": "Rücken",
    "lower-back": "Rücken",
    "trapezius": "Rücken",
    "front-deltoids": "Schultern",
    "back-deltoids": "Schultern",
    "neck": "Schultern",
    "biceps": "Arme",
    "triceps": "Arme",
    "forearm": "Arme",
    "abs": "Rumpf",
    "obliques": "Rumpf",
    "quadriceps": "Beine",
    "hamstring": "Beine",
    "gluteal": "Beine",
    "abductors": "Beine",
    "adductor": "Beine",
    "calves": "Beine",
}
"""The body part a muscle belongs to, which names a strength note's folder."""

KINDS = ("strength", "cardio", "mobility", "test")
KIND_NAMES = {"strength": "Kraft", "cardio": "Cardio", "mobility": "Mobilität", "test": "Tests"}
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


def region(exercise: Exercise) -> str:
    """The body part of the first primary muscle, or `Sonstige` for a note that names none."""
    return next((REGIONS[m] for m in exercise.muscles_primary[:1]), "Sonstige")


def folder(exercise: Exercise) -> str:
    """The subfolder the note goes in: strength by body part, every other kind on its own."""
    kind = KIND_NAMES[exercise.kind]
    return f"{kind}/{region(exercise)}" if exercise.kind == "strength" else kind


def tags(exercise: Exercise) -> tuple[str, ...]:
    """`übung`, the kind, the body part and the equipment, lowercase as the vault's tags are."""
    found = ["übung", KIND_NAMES[exercise.kind], *exercise.equipment]
    if exercise.muscles_primary:
        found.insert(2, region(exercise))
    return tuple(dict.fromkeys(t.lower().replace(" ", "-") for t in found))


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
        ("tags", tags(exercise)),
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
