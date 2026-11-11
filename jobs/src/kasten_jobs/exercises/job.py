"""The command: gather the exercises, give each a free name, and create the notes kasten lacks.

A note already at a path is left as it is, so a second run writes nothing.
"""

import argparse
import logging
import os
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

from kasten_jobs.exercises.mobility import mobility
from kasten_jobs.exercises.note import Exercise, file_name, render
from kasten_jobs.exercises.sources import fetch_free_db, fetch_wger, from_wger
from kasten_jobs.kasten_api import KastenApi

if TYPE_CHECKING:
    from collections.abc import Mapping

log = logging.getLogger("kasten_jobs.exercises")

USER_AGENT = "kasten-exercise-import"


@dataclass(frozen=True)
class Settings:
    """What the environment sets; docs/reference/training/exercise-import.md lists both."""

    api: str
    folder: str

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        """Read the settings, each with its default."""
        return cls(
            api=env.get("KASTEN_API", "http://kasten-backend-prod:8000"),
            folder=env.get("EXERCISE_FOLDER", "03 Areas/11 Fitness/Übungen").strip("/"),
        )


def gather(client: httpx.Client) -> list[Exercise]:
    """The mobility programme first, then wger by id, so a name clash goes the same way each run."""
    free_db = fetch_free_db(client)
    rows = sorted(fetch_wger(client), key=lambda row: row["id"])
    wger = [e for row in rows if (e := from_wger(row, free_db)) is not None]
    return [*mobility(), *wger]


def named(exercises: list[Exercise]) -> list[tuple[str, Exercise]]:
    """Each exercise with a file name no earlier one took, its English alias added on a clash."""
    taken: set[str] = set()
    out: list[tuple[str, Exercise]] = []
    for exercise in exercises:
        candidates = [file_name(exercise.name)]
        if exercise.aliases:
            candidates.append(file_name(f"{exercise.name} ({exercise.aliases[0]})"))
        name = next((c for c in candidates if c and c.lower() not in taken), None)
        if name is None:
            log.info("Skipped %s: its name is taken", exercise.name)
            continue
        taken.add(name.lower())
        out.append((name, exercise))
    return out


def run(api: KastenApi, folder: str, exercises: list[Exercise], *, dry_run: bool) -> int:
    """Create every note not there yet, and answer 1 when kasten refused one."""
    created = existing = failed = 0
    for name, exercise in named(exercises):
        path = f"{folder}/{name}.md"
        if dry_run:
            sys.stdout.write(f"{path}\n")
            continue
        try:
            made = api.create_note(path, render(exercise))
        except httpx.HTTPStatusError as error:
            log.warning("kasten refused %s: %s", path, error.response.text[:200])
            failed += 1
            continue
        created, existing = created + made, existing + (not made)
    log.info("%d notes created, %d there already, %d refused", created, existing, failed)
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    """`kasten-exercise-import [--dry-run]`."""
    parser = argparse.ArgumentParser(prog="kasten-exercise-import", description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print the paths, write nothing")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = Settings.from_env(os.environ)
    headers = {"User-Agent": USER_AGENT}
    with (
        httpx.Client(headers=headers, timeout=60, follow_redirects=True) as web,
        httpx.Client(base_url=settings.api, timeout=30) as kasten,
    ):
        exercises = gather(web)
        return run(KastenApi(kasten), settings.folder, exercises, dry_run=args.dry_run)
