"""Finding every todo in the vault, by reading the vault, and the project each is in.

One rg pass over the notes, the same way search reads them and for the same
reason: the files are the source of truth, so nothing here is indexed and
nothing here can go stale.

The backend does not parse a todo's state or fields. It finds the lines that
could be one and hands them over whole, because the editor has to parse a line
anyway and two parsers in two languages drift. The one thing it does read is
the project, which needs only a line's indent, its tags and its links: an agent
reading the endpoint then sees the lane the board draws, without a copy of the
rule of its own. Links are read by `links.py`, whose rule both sides test
against one file of cases.
"""

import re
from typing import TYPE_CHECKING

from kasten_backend.links import WIKILINK, link_path
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

TODO_LINE = r"^[ \t]*- \[[ /xXbwr-]\]([ \t]|$)"
"""A checkbox list item at any indent, in any of the seven states.

`X` is in the class because another editor may write it and the frontend reads
it as done. `R` is not, because nothing writes it and the frontend reads
`[R]` as no todo. `[` is not either, which is what keeps `- [[borges]]` out. The `- ` anchor
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


PROJECT_ROOTS = ("02 Projects", "03 Areas")
"""The folders whose subfolders are projects.

Fixed rather than a setting: a vault without them sees every todo in no
project, and a rule per vault would have to reach every reader of the lines.
Areas count because client work lives there; resources do not, or every
reading list would be a project.
"""

LINK_ROOT = "02 Projects"
"""The one root a link or a tag files a todo under.

Not areas: a daily todo names people far more often than projects, and the
people live in `03 Areas/08 People`. A tag would have to spell an area's
number, `06 Allianz Direct`, which nobody types.
"""

TAG = re.compile(r"(?<![\w/])#[^\W\d][\w/-]*")
"""`#tag`, as `tags.TAG` reads one, spelled for `re`, which has no `\\p{L}`.

`[^\\W\\d]` is a letter or an underscore. A lookbehind here where `tags.TAG`
consumes a character, because rg's engine has none and this one does. So
`#p/fde.` at the end of a sentence reads as `#p/fde`, and `[[note#p/x]]` holds
no tag. A link or a code span is not masked, because the board's own tag
reading does not mask one either.
"""


def _project_in(path: str, roots: tuple[str, ...]) -> str | None:
    """The project folder `path` lies in under one of `roots`, at any depth."""
    # Root, folder and at least the file: a note directly in a root is in none.
    root, _, rest = path.partition("/")
    folder, slash, _ = rest.partition("/")
    if root not in roots or not slash:
        return None
    return f"{root}/{folder}"


def _spoken(name: str) -> str:
    """A folder name or a tag's word as compared: no case, and `-` or `_` for a space."""
    return name.lower().replace("-", " ").replace("_", " ")


def _tag_project(text: str, folders: dict[str, str]) -> str | None:
    """The folder the first `#p/x` tag on `text` that names one names.

    A tag naming nothing is passed over, as a link to a missing note is: a typo
    would otherwise make a project nobody made. `#p/x/y` names `x`, a project
    being one folder deep.
    """
    for tag in TAG.findall(text):
        if tag[1:3].lower() != "p/":
            continue
        folder = folders.get(_spoken(tag[3:].split("/")[0]))
        if folder is not None:
            return folder
    return None


def _link_project(text: str, paths: list[str]) -> str | None:
    """The project of the first link on `text` that lands on a note in one."""
    for target in WIKILINK.findall(text):
        # A name of only spaces is no name, as the editor's `wikiLinkTargets` has it.
        if not target.strip():
            continue
        linked = link_path(target, paths)
        if linked not in paths:
            continue
        project = _project_in(linked, (LINK_ROOT,))
        if project is not None:
            return project
    return None


def projects_of(hits: list[Hit], paths: list[str]) -> list[str | None]:
    """The project of each hit, in the order of `hits`, against the notes in `paths`.

    For a todo, the first of: a `#p/x` tag on it or on the nearest todo it is a
    part of; the note's project folder; the first link on it into a project;
    the project of the todo it is a part of. A session line is no todo, so it
    has none and is no todo's parent.

    A part is a child of the nearest todo above it with a smaller indent, as
    the editor's `treeOf` reads one, prose between the two ending nothing.
    """
    # Only folders something is filed in: an empty one is no project to name.
    folders: dict[str, str] = {}
    for path in paths:
        project = _project_in(path, (LINK_ROOT,))
        if project is not None:
            folders.setdefault(_spoken(project.split("/")[1]), project)

    found: dict[tuple[str, int], str | None] = {}
    by_note: dict[str, list[Hit]] = {}
    for hit in hits:
        by_note.setdefault(hit.path, []).append(hit)

    for note, lines in by_note.items():
        folder = _project_in(note, PROJECT_ROOTS)
        # The todos open above this one, shallowest first: indent, the tag
        # project it passes down, and its whole project.
        above: list[tuple[int, str | None, str | None]] = []
        # rg answers in any order, and a parent has to come before its parts.
        for hit in sorted(lines, key=lambda one: one.line):
            if re.match(TODO_LINE, hit.text) is None:
                continue
            # A tab counts one, as the editor's `parseTodo` counts it.
            indent = len(hit.text) - len(hit.text.lstrip(" \t"))
            while above and above[-1][0] >= indent:
                above.pop()
            parent_tag, parent = (above[-1][1], above[-1][2]) if above else (None, None)

            tagged = _tag_project(hit.text, folders) or parent_tag
            project = tagged or folder or _link_project(hit.text, paths) or parent
            found[(note, hit.line)] = project
            above.append((indent, tagged, project))

    return [found.get((hit.path, hit.line)) for hit in hits]
