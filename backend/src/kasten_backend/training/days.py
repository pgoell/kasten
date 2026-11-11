"""Training lines added to a day's note by a job, such as the Garmin sync, never one twice.

A line already in the note, word for word, is left out, so a job that runs again writes nothing.
"""

from typing import TYPE_CHECKING

from kasten_backend import periodic
from kasten_backend.done_log import rewrite
from kasten_backend.periodic import append_under

if TYPE_CHECKING:
    from datetime import date

    from kasten_backend.config import Settings

TRAINING = "## Training"


async def add_lines(settings: Settings, day: date, lines: list[str]) -> list[str]:
    """Put each line not yet in `day`'s note under its `## Training`, making note and section.

    Answers the lines it added, in order. Read and write share one hold of the vault lock.
    """
    added: list[str] = []

    def change(text: str) -> str | None:
        held = {line.rstrip() for line in text.split("\n")}
        for line in lines:
            if line in held:
                continue
            text = append_under(text, TRAINING, line)
            held.add(line)
            added.append(line)
        return text if added else None

    await rewrite(
        settings,
        periodic.daily_path(day, settings.periodic_path),
        change,
        fresh=periodic.daily_note(day, settings.periodic_path),
    )
    return added
