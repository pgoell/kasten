"""The note that tells an agent how this vault's todos are written.

Every vault gets one, written at startup when it holds none, because the agents
that read it do not all live in the app: one in a terminal pane and one on your
laptop both find it by opening the note. A key press could not write it, since
the agent outside the app never presses one.

It is a note like any other after that. Edit it, move it, delete it; a deleted
one comes back the next time the backend starts, which is the same bargain the
saved views note makes.
"""

from pathlib import Path

from kasten_backend.frontmatter import stamp
from kasten_backend.vault import create_note, resolve_path
from kasten_backend.vcs import begin_change, snapshot

GUIDE_PATH = "99 Misc/01 Config/01 Agents/How-To-TODO.md"
"""Where it lives, beside the saved views the todo pane writes."""

GUIDE_TEXT = (Path(__file__).parent / "how-to-todo.md").read_text(encoding="utf-8")
"""What it says, read off the package once rather than spelled in Python.

Markdown in a Python string is markdown nobody can read in a diff, and this one
is the length of a documentation page.
"""


async def write_guide(root: Path) -> None:
    """Write the guide into `root`, unless the vault holds one already.

    Bracketed by a jj change the way every other write is, so the note arrives
    in the history rather than as a surprise in somebody's next diff.
    """
    note = resolve_path(root, GUIDE_PATH)
    if note is None or note.exists():
        return

    await begin_change(root, GUIDE_PATH)
    create_note(note, stamp(GUIDE_TEXT))
    await snapshot(root)
