"""The list of files exempt from Biome's cognitive-complexity rule only shrinks.

`frontend/biome.jsonc` turns `noExcessiveCognitiveComplexity` on as an error
and off again for the files that failed it when the rule came in (#939). The
list exists so the rule could start without fixing every file at once; adding a
file to it to get a commit through would undo the rule. The comment lines are
dropped before parsing, because Python's json reads no comments and the config
has only whole-line ones.
"""

import json
from pathlib import Path

REPO = Path(__file__).parents[2]
RULE = "noExcessiveCognitiveComplexity"
# Lower this when a pull request takes files off the list. Never raise it.
MAX_FILES = 76


def test_the_complexity_baseline_never_grows() -> None:
    text = (REPO / "frontend/biome.jsonc").read_text(encoding="utf-8")
    config = json.loads(
        "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("//"))
    )

    rule = config["linter"]["rules"]["complexity"][RULE]
    assert rule["level"] == "error", f"frontend/biome.jsonc: {RULE} must run as an error."

    baselines = [
        entry
        for entry in config["overrides"]
        if entry.get("linter", {}).get("rules", {}).get("complexity", {}).get(RULE) == "off"
    ]
    assert len(baselines) == 1, (
        f"frontend/biome.jsonc: expected one overrides entry turning {RULE} off, "
        f"found {len(baselines)}."
    )

    files = baselines[0]["includes"]
    assert len(files) <= MAX_FILES, (
        f"frontend/biome.jsonc: the {RULE} baseline holds {len(files)} files, more than "
        f"{MAX_FILES}. The list may only shrink: make the new function simpler instead."
    )
