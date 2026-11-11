"""The exercises of the vault's `Mobilitätsprogramm.md`, written down by hand in `mobility.tsv`.

The programme names its exercises in table cells, not as names, so the list is
kept here rather than read from the note. The tests they train exist already.
"""

from importlib.resources import files

from kasten_jobs.exercises.note import Exercise

TESTS = {
    "Sprunggelenk": "Knie-zur-Wand",
    "Großzeh": "Großzeh-Streckung",
    "Oberschenkelrückseite": "Gestrecktes Bein heben",
    "Hüftbeuger und vorderer Oberschenkel": "Modifizierter Thomas-Test",
    "Hüfte: Rotation": "Hüft-Innenrotation",
    "Adduktoren": "Grätsche an der Wand",
    "Brustwirbelsäule": "Brustwirbelsäulen-Rotation",
    "Schulter: Überkopf": "Schulter-Beugung",
    "Schulter: Rotation": "Schulter-Rotation",
    "Handgelenk": "Handgelenk-Streckung",
    "Nacken": "Nacken-Rotation",
}
"""Each region of the programme, and the test note that measures it."""


def _list(cell: str, sep: str = ",") -> tuple[str, ...]:
    return tuple(part.strip() for part in cell.split(sep) if part.strip())


def mobility() -> list[Exercise]:
    """Every exercise the programme names, in its order, as `kind: mobility` notes."""
    text = files("kasten_jobs.exercises").joinpath("mobility.tsv").read_text(encoding="utf-8")
    out: list[Exercise] = []
    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, region, variant, counts, primary, secondary, equipment, aliases, cue = line.split(
            "\t"
        )
        test = TESTS[region]
        out.append(
            Exercise(
                name=name,
                kind="mobility",
                counts=counts,
                source="Mobilitätsprogramm",
                credit="Quelle: [[Mobilitätsprogramm]], eigene Notiz.",
                aliases=_list(aliases, ";"),
                muscles_primary=_list(primary),
                muscles_secondary=_list(secondary),
                equipment=_list(equipment),
                cues=(
                    cue,
                    "",
                    f"Region {region}, Variante {variant} im [[Mobilitätsprogramm]]. "
                    f"Test: [[{test}]].",
                ),
                extra={"region": region, "test": f"[[{test}]]"},
            )
        )
    return out
