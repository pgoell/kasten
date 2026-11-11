"""Training lines added to a day's note by a job, such as the Garmin sync.

Every line is written, a copy of one already there too: two rides can read the same, and the
job's own state is what keeps a rerun from writing again.
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
    """Put each line under `day`'s `## Training`, making note and section where missing.

    Answers the lines it added, in order. Read and write share one hold of the vault lock.
    """
    added: list[str] = []

    def change(text: str) -> str:
        for line in lines:
            text = append_under(text, TRAINING, line)
            added.append(line)
        return text

    await rewrite(
        settings,
        periodic.daily_path(day, settings.periodic_path),
        change,
        fresh=periodic.daily_note(day, settings.periodic_path),
    )
    return added
