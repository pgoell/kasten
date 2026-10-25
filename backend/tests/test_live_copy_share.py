"""The live copy proof (#810 A11): what each list write does to every real list.

Skipped unless `KASTEN_LIVE_COPY` (a read-only copy of the vault) and
`KASTEN_LIVE_OUT` (a directory to write into) are both set. The lists are copied
into a vault of this test's own, so the copy is never written. Every write runs on
a fresh copy of its note, and each list's results land in one JSON file, so main
and the branch can be compared with `diff -r`.
"""

import contextlib
import itertools
import json
import os
import re
import shutil
from collections.abc import Awaitable, Callable
from datetime import date
from pathlib import Path

import pytest

from kasten_backend import share
from kasten_backend.config import Settings

COPY = os.environ.get("KASTEN_LIVE_COPY", "")
OUT = os.environ.get("KASTEN_LIVE_OUT", "")

PEOPLE = {"pascal@example.test": "Pascal", "alicia@example.test": "Alicia"}
TODAY = date.today().isoformat()
COUNT = itertools.count()

Step = Callable[[Settings, str], Awaitable[object]]


def settings_for(root: Path) -> Settings:
    """Settings for a vault at `root`, with the people when the setting exists."""
    if "share_people" in Settings.model_fields:
        return Settings(vault_path=root, share_people=PEOPLE)
    return Settings(vault_path=root)


def fresh(base: Path, name: str, raw: bytes) -> Settings:
    """A vault of its own holding one list's note, exactly as read."""
    root = base / f"case-{next(COUNT)}"
    (root / "05 Shared").mkdir(parents=True)
    (root / "05 Shared" / f"{name}.md").write_bytes(raw)
    return settings_for(root)


def note_text(settings: Settings, name: str) -> str:
    """The note's text as it stands in the vault."""
    return (settings.vault_path / settings.share_folder / f"{name}.md").read_bytes().decode("utf-8")


def normal(text: str) -> str:
    """The note with today's date, the kt id and the save time fixed, so two runs compare."""
    text = text.replace(TODAY, "DATE")
    text = re.sub(r"kt-[0-9a-f]{6}", "kt-xxxxxx", text)
    return re.sub(r"^modified: [^\r\n]*", "modified: TIME", text, flags=re.MULTILINE)


async def sha_of(settings: Settings, name: str) -> str:
    """The digest of the list as the vault holds it now."""
    current = await share.read(settings, name)
    assert current is not None
    assert current.sha is not None
    return current.sha


def tick(line: int, done: bool) -> Step:
    """Tick or untick one line."""

    async def step(settings: Settings, name: str) -> object:
        return await share.tick(settings, name, line, done, await sha_of(settings, name))

    return step


def tick_all() -> Step:
    """Tick every open item, one at a time, leaving the ones kasten refuses open."""

    async def step(settings: Settings, name: str) -> object:
        for item in share.items(note_text(settings, name)):
            if not item.done:
                with contextlib.suppress(share.TickInKastenError):
                    await share.tick(settings, name, item.line, True, await sha_of(settings, name))
        return None

    return step


def assign(line: int, who: str | None) -> Step:
    """Assign one line to a person, or clear it with None."""

    async def step(settings: Settings, name: str) -> object:
        return await share.assign(settings, name, line, who, await sha_of(settings, name))

    return step


def add(text: str) -> Step:
    """Append one item."""

    async def step(settings: Settings, name: str) -> object:
        return await share.add(settings, name, text, await sha_of(settings, name))

    return step


def clear() -> Step:
    """Remove the ticked items, Leeren."""

    async def step(settings: Settings, name: str) -> object:
        return await share.clear(settings, name, await sha_of(settings, name))

    return step


async def outcome(base: Path, name: str, raw: bytes, *steps: Step) -> object:
    """The note after the steps, run on a fresh copy, or the refusal a tick met."""
    settings = fresh(base, name, raw)
    try:
        for step in steps:
            await step(settings, name)
    except share.TickInKastenError as error:
        return {"refused": str(error)}
    return normal(note_text(settings, name))


@pytest.mark.skipif(not (COPY and OUT), reason="KASTEN_LIVE_COPY and KASTEN_LIVE_OUT are not set")
async def test_live_copy_every_list_write(tmp_path: Path) -> None:
    shared = tmp_path / "vault" / "05 Shared"
    shared.mkdir(parents=True)
    for note in sorted((Path(COPY) / "05 Shared").iterdir()):
        if note.is_file() and note.suffix == ".md":
            shutil.copy2(note, shared / note.name)

    settings = settings_for(tmp_path / "vault")
    out = Path(OUT)
    base = tmp_path / "cases"
    has_assign = hasattr(share, "assign")

    for name in share.names(settings):
        raw = (shared / f"{name}.md").read_bytes()
        text = raw.decode("utf-8")
        items = share.items(text)
        plan: dict[str, list[Step]] = {
            "add Testeintrag": [add("Testeintrag")],
            "clear after every item ticked": [tick_all(), clear()],
        }
        for item in items:
            label = f"L{item.line}"
            plan[f"{label} tick"] = [tick(item.line, True)]
            plan[f"{label} tick untick"] = [tick(item.line, True), tick(item.line, False)]
            if has_assign:
                plan[f"{label} assign Pascal"] = [assign(item.line, "Pascal")]
                plan[f"{label} assign Alicia"] = [assign(item.line, "Alicia")]
                plan[f"{label} assign Pascal then Alicia"] = [
                    assign(item.line, "Pascal"),
                    assign(item.line, "Alicia"),
                ]
                plan[f"{label} assign Pascal then None"] = [
                    assign(item.line, "Pascal"),
                    assign(item.line, None),
                ]

        cases: dict[str, object] = {}
        for label, steps in plan.items():
            cases[label] = await outcome(base, name, raw, *steps)
        record = {
            "lines": len(text.split("\n")),
            "open": sum(not item.done for item in items),
            "done": sum(item.done for item in items),
            "items": [item.model_dump() for item in items],
            "cases": cases,
        }
        (out / f"{name}.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
            encoding="utf-8",
        )
