"""Finding every todo in the vault, by reading the vault.

One rg pass over the notes, the same way search reads them and for the same
reason: the files are the source of truth, so nothing here is indexed and
nothing here can go stale.

The backend does not parse a todo. It finds the lines that could be one and
hands them over whole, because the editor has to parse a line anyway and two
parsers in two languages drift.
"""

from typing import TYPE_CHECKING

from kasten_backend.search import scan_vault

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.search import Hit

MOST_TODOS = 100_000
"""How many matching lines come back at most.

A backstop against one generated file with a million list items in it, not a
limit on how much work a person is willing to read. 5,000 said the second while
doing the first: it is a judgment about reading, and reaching it truncates
silently, so the client draws a shorter list than the vault holds with nothing
on screen to say so. A short list is worse than a long one, so the number now
sits where nothing written by hand reaches it.
"""

TODO_LINE = r"^[ \t]*- \[[ /xXb-]\]([ \t]|$)"
"""A checkbox list item at any indent, in any of the five states.

`X` is in the class because another editor may write it and the frontend reads
it as done. `[` is not, which is what keeps `- [[borges]]` out. The `- ` anchor
is what keeps an ordered list item out. The `-` sits last in the class, where a
character class reads it as itself rather than as a range.
"""

SESSION_LINE = r"^[ \t]*- [0-9]{2}:[0-9]{2}-([ \t]|$)"
"""One line of a `## Time` section, running: a start time and no end.

The scan answers one view, and that view wants to know which rows are running.
A closed session tells it nothing the task line does not already carry, its
total being written there on every stop, and the closed ones are the only lines
in this feature that pile up. So the end time is out of the pattern rather than
optional in it, which keeps a response refetched on every write to the vault as
small as the number of timers actually going.

A stop reads the closed ones another way, through `GET /api/search` on the
todo's id: one narrow pass at the press, for one todo.
"""

TODO_PATTERN = f"{TODO_LINE}|{SESSION_LINE}"


async def find_todos(root: Path, skip: str | None = None) -> list[Hit]:
    """Every todo line and every time session line the vault holds, up to `MOST_TODOS`.

    `skip` names a folder to walk past, which is how the archive stays off the
    todo list by default. A finished project's open checkboxes are the clearest
    case of work that is not work: they are true of the note and false of the
    week, and left in they are the rows that make the pane not worth opening.
    """
    # `-e` so the pattern, which opens with a caret and holds a dash, is a
    # pattern and not a flag.
    return await scan_vault(root, ("-e", TODO_PATTERN), MOST_TODOS, skip)
