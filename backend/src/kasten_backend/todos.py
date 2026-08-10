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

MOST_TODOS = 5_000
"""How many matching lines come back at most.

Search's `MOST_HITS` is 2,000 because it answers a keystroke. This answers one
view, opened by one key, so it can afford more, and 5,000 open todos is a vault
nobody is reading to the end of anyway.
"""

TODO_LINE = r"^[ \t]*- \[[ /xXb-]\]([ \t]|$)"
"""A checkbox list item at any indent, in any of the five states.

`X` is in the class because another editor may write it and the frontend reads
it as done. `[` is not, which is what keeps `- [[borges]]` out. The `- ` anchor
is what keeps an ordered list item out. The `-` sits last in the class, where a
character class reads it as itself rather than as a range.
"""

SESSION_LINE = r"^[ \t]*- [0-9]{2}:[0-9]{2}-([0-9]{2}:[0-9]{2})?([ \t]|$)"
"""One line of a `## Time` section, closed or still running.

Nothing in phase 1 reads these. They are in the pattern because one rg pass is
the point, and because phase 3 must not have to change what phase 1 fixed.
"""

TODO_PATTERN = f"{TODO_LINE}|{SESSION_LINE}"


async def find_todos(root: Path) -> list[Hit]:
    """Every todo line and every time session line the vault holds, up to `MOST_TODOS`."""
    # `-e` so the pattern, which opens with a caret and holds a dash, is a
    # pattern and not a flag.
    return await scan_vault(root, ("-e", TODO_PATTERN), MOST_TODOS)
