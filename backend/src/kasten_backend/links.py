"""Pointing `[[wikilinks]]` at a note that has moved.

A link names a note rather than a place, so a bare `[[borges]]` follows the note
between folders on its own and there is nothing here for it to answer. A link
that spelled the path out does not follow, and a rename that changed the note's
name breaks both. This is what keeps the vault's links pointing where they were
written to point.

A markdown link is the other kind, and it follows a move too. It is read
relative to the file it sits in, so it breaks when its target moves and when the
file holding it moves, and an `index.md` is made of nothing else.

The rule a target is read by is the frontend's, in `frontend/src/lib/wikilink.ts`,
and the two have to agree: the note `gf` opens is the note a rename here follows.
That is `splitTarget` taking the heading and the alias off `[[name#heading|alias]]`,
then `wikiLinkPath` finding the note the name is. `names_a_file` and
`named_path` are the half of `wikiLinkPath` that tells a file from a note. Two
copies of one rule is the cost of the editor resolving a link without asking the
server, so the cases live once, in `backend/tests/link_paths.json`, and both
test suites read them.
"""

import posixpath
import re
from bisect import bisect_right
from typing import TYPE_CHECKING, NamedTuple
from urllib.parse import unquote

from kasten_backend.search import notes_holding
from kasten_backend.vault import (
    ASSET_MAGIC,
    HTML_SUFFIX,
    books_beside,
    encode_href,
    list_assets,
    list_html,
    list_markdown_files,
    write_note,
)

if TYPE_CHECKING:
    from pathlib import Path

SUFFIX = ".md"

FILE_SUFFIXES = (HTML_SUFFIX, *ASSET_MAGIC)
"""What a link's name ends in when it names a file, not a note: `[[report.html]]`, `[[a.pdf]]`."""

WIKILINK = re.compile(r"\[\[([^\[\]\n]+)\]\]")
"""One `[[link]]`, spelled the way the editor's parser spells it.

A bracket or a line break inside means the `[[` opened nothing: a link names one
note, and it names it on one line. A target of only spaces is refused below,
where the text is in hand, rather than by a longer pattern here.
"""


MARKDOWN_LINK = re.compile(r'(!?\[[^\]\n]*\]\()([^)\s]+)((?:\s+"[^"\n]*")?\))')
"""One `[text](href)` or `![alt](href)`, with an optional title after the href.

The href holds no space, which is why the index guide asks for `%20`: a raw
space ends the link for every reader, so it ends it here too.
"""

SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
"""An href that names a place outside the vault: `https:`, `mailto:` and the rest."""

FENCE = re.compile(r" {0,3}(`{3,}|~{3,})(.*)")
"""A line that opens or closes a fenced code block, and what follows the fence on it."""

BACKTICKS = re.compile(r"`+")
"""One run of backticks, which opens or closes an inline code span."""


class Target(NamedTuple):
    """What `[[name#heading|alias]]` is made of: the note, its heading, and the link's words."""

    name: str
    heading: str | None
    alias: str | None


def split_target(target: str) -> Target:
    """`target` taken apart the way the editor's `splitTarget` takes it.

    The bar is taken first, so an alias may carry a hash or a slash and still be
    an alias. An empty name is a link to a heading of the note it sits in. In a
    table a bare bar ends the cell, so a link there writes the bar escaped, and the
    backslash is the table's, not the name's.
    """
    named, bar, alias = target.partition("|")
    if bar:
        named = named.removesuffix("\\")
    name, _, heading = named.partition("#")
    return Target(name.strip(), heading.strip() or None, alias.strip() or None)


def names_a_file(name: str) -> bool:
    """Whether a link's name, already split, names a page or an asset rather than a note.

    Ignoring case, the way a bare name is looked up, so `[[Plan.PDF]]` is the
    pdf and not a note called `Plan.PDF.md`. Only the last segment counts, so a
    folder with a dot in it names no file.
    """
    return name.rsplit("/", 1)[-1].lower().endswith(FILE_SUFFIXES)


def named_path(name: str) -> str:
    """The path a link's name spells: the file as written, or the note with `.md` on.

    The one rule `link_path` and the graph's `resolver` both read, so the note a
    rename follows is the note the graph draws an edge to.
    """
    if names_a_file(name) or name.endswith(SUFFIX):
        return name
    return f"{name}{SUFFIX}"


def link_path(target: str, paths: list[str]) -> str:
    """The vault path `[[target]]` names, whether or not a note is there.

    Only the name counts: `[[borges#Ficciones|his]]` names what `[[borges]]` does.
    A name with a slash in it is a path and is taken at its word. A bare name
    is looked for anywhere in the vault, ignoring case, so `[[borges]]` names
    `reading/borges.md` from any note. `paths` arrives sorted, so a note of that
    name at the vault root wins over one in a folder.

    A name nothing answers to comes back as it was written, where the editor's
    copy answers `<inbox>/<name>.md`. That is a rule about where a note is made
    and not about which note a link names: what this feeds is a mapping keyed by
    notes that exist, which a path nothing answers to is not in either way.
    """
    # A page or an asset is named by its whole file name, so `[[report.html]]`
    # and `[[report]]` are two files.
    path = named_path(split_target(target).name)
    if path in paths or "/" in path:
        return path

    name = path.lower()
    return next((other for other in paths if other.rsplit("/", 1)[-1].lower() == name), path)


def _name(path: str) -> str:
    """The note's name: the last segment, without the suffix."""
    return path.rsplit("/", 1)[-1][: -len(SUFFIX)]


def _respell(name: str, new: str) -> str:
    """`name`, a link's name, written for a note now at `new`, keeping the spelling it had.

    A path stays a path and a name stays a name, which is what leaves
    `[[borges]]` alone when only the folder changed. The `.md` goes either way:
    a link is read the same with or without it, and one spelling is enough. A
    page keeps its `.html`, which is the only thing telling it from a note.
    """
    stem = new.removesuffix(SUFFIX)
    return stem if "/" in name else stem.rsplit("/", 1)[-1]


def code_spans(text: str) -> list[tuple[int, int]]:
    """Where `text` holds code, as `(start, end)` offsets: fenced blocks, then inline spans.

    A `[[x]]` in code is an example of the syntax and not a link, so a move
    leaves it as written, the way Obsidian does. The fences are CommonMark's:
    three or more backticks or tildes, indented by at most three spaces, closed
    by a line of the same character at least as long, and a fence nobody closed
    runs to the end of the note. A backtick fence whose info string holds a
    backtick is inline code and opens nothing.

    An indented block is not read as code. Four spaces is also how a list item
    continues, and a link in one of those is a link.

    Where the reading is in doubt the text is not code: a link wrongly taken
    for code is left pointing at nothing, and one wrongly taken for a link is
    only rewritten, as every move did before this read code at all.

    Split on the line feed alone, not `splitlines`, which also breaks at a form feed or
    U+2028 and would open a fence in the middle of a line.
    """
    spans = []
    fence: tuple[str, int] | None = None
    offset = 0
    for line in text.split("\n"):
        end = min(offset + len(line) + 1, len(text))
        marker = FENCE.match(line)
        if fence is not None:
            if (
                marker
                and marker[1][0] == fence[0][0]
                and len(marker[1]) >= len(fence[0])
                and not marker[2].strip()
            ):
                spans.append((fence[1], end))
                fence = None
        elif marker and not (marker[1][0] == "`" and "`" in marker[2]):
            fence = (marker[1], offset)
        else:
            spans += [(offset + start, offset + stop) for start, stop in _inline_code(line)]
        offset += len(line) + 1
    if fence is not None:
        spans.append((fence[1], len(text)))
    return spans


def _inline_code(line: str) -> list[tuple[int, int]]:
    """The inline code spans of one line: a run of backticks closed by the next run as long.

    One line, where CommonMark lets a span run on to the end of its paragraph:
    telling where a paragraph ends means parsing lists, headings and tables, and
    a stray backtick in one list item must not hide the links of the next.

    A run after a backslash opens nothing, the backtick being escaped. A run
    inside a `[[link]]` opens and closes nothing, so a backtick in an alias does
    not pair with one later on the line; a link wholly inside a span is still
    in it.

    Paired by a walk over the runs rather than by a pattern, which would scan to
    the end of the line from every unclosed run.
    """
    masked = WIKILINK.sub(lambda link: " " * len(link[0]), line)
    runs = [(run.start(), run.end()) for run in BACKTICKS.finditer(masked)]

    closers: list[int | None] = [None] * len(runs)
    later: dict[int, int] = {}
    for index in reversed(range(len(runs))):
        start, stop = runs[index]
        closers[index] = later.get(stop - start)
        later[stop - start] = index

    spans = []
    index = 0
    while index < len(runs):
        start = runs[index][0]
        closer = closers[index]
        if closer is None or masked[start - 1 : start] == "\\":
            index += 1
            continue
        spans.append((start, runs[closer][1]))
        index = closer + 1
    return spans


def _in_code(position: int, spans: list[tuple[int, int]]) -> bool:
    """Whether `position` falls in one of `spans`, which `code_spans` returns sorted and apart.

    A search rather than a scan of every span, which on a long note full of code
    held the event loop for seconds: one scan per link.
    """
    index = bisect_right(spans, position, key=lambda span: span[0])
    return index > 0 and position < spans[index - 1][1]


def relink(text: str, moves: dict[str, str], paths: list[str]) -> str:
    """`text` with every link naming a note in `moves` naming where it lands.

    A mapping rather than one pair, because a folder's move is one rewrite over
    many notes. Doing it as one pass per note moved would read the vault once
    per note in the subtree, and a link would be resolved against a listing that
    a previous pass had already made wrong.
    """
    code = code_spans(text)

    def rewrite(match: re.Match[str]) -> str:
        if _in_code(match.start(), code):
            return match.group(0)
        target = match.group(1)
        name = split_target(target).name
        # `[[#Risks]]` is a heading of the note it sits in, and names no note
        # a move could take somewhere else.
        if not name:
            return match.group(0)

        new = moves.get(link_path(target, paths))
        if new is None:
            return match.group(0)
        # The heading and the alias are the writer's and stay as typed, spaces
        # and all. Only the name before them is respelled.
        tail = target[target.index(name) + len(name) :]
        return f"[[{_respell(name, new)}{tail}]]"

    return WIKILINK.sub(rewrite, text)


def moved(path: str, old: str, new: str) -> str:
    """Where `path` lands when `old` moves to `new`, which is where it was if neither holds it.

    One rule for a note and a folder. A note's path never starts with itself
    and a slash, so the second test is only ever true of a folder's contents.
    """
    if path == old:
        return new
    if path.startswith(f"{old}/"):
        return f"{new}{path[len(old) :]}"
    return path


def _split(href: str) -> tuple[str, str] | None:
    """`href` as the path it names and the `#` or `?` tail, or None for one outside the vault.

    A leading `{` is a template placeholder, which the guides use inside their
    examples, and a leading `/` is absolute in a vault that has no root path.
    """
    if SCHEME.match(href) or href.startswith(("/", "#", "{")):
        return None

    cut = min((i for i in (href.find("#"), href.find("?")) if i != -1), default=len(href))
    return href[:cut], href[cut:]


def markdown_target(href: str, here: str) -> str | None:
    """The vault path `href` names from a file in folder `here`, or None.

    None for an href outside the vault, including one that climbs above its
    root. A folder comes back without its trailing slash, the way `moved`
    spells one.
    """
    split = _split(href)
    if split is None:
        return None

    target = posixpath.normpath(posixpath.join(here, unquote(split[0])))
    if target == ".." or target.startswith("../"):
        return None
    return target


def relink_markdown(text: str, before: str, after: str, old: str, new: str) -> str:
    """`text`, held by the file at `before` and about to be at `after`, with `old` at `new`.

    Two things move a relative link, and either one rewrites it: its target
    moving, and the file holding it moving to another folder. A link between
    two files that move together is untouched, which is what keeps a moved
    folder's own index working.

    A link that still lands where it did keeps its spelling. One that changes
    is written the short way from the new folder, keeping a trailing slash and
    a leading `./` where it had them.
    """
    here = posixpath.dirname(before)
    there = posixpath.dirname(after)
    code = code_spans(text)

    def rewrite(match: re.Match[str]) -> str:
        if _in_code(match.start(), code):
            return match.group(0)
        href = match.group(2)
        target = markdown_target(href, here)
        if target is None:
            return match.group(0)

        landed = moved(target, old, new)
        if landed == target and here == there:
            return match.group(0)

        written, tail = _split(href) or (href, "")
        relative = posixpath.relpath(landed, there or ".")
        if unquote(written).endswith("/"):
            relative = f"{relative}/"
        if written.startswith("./") and not relative.startswith("."):
            relative = f"./{relative}"
        return f"{match.group(1)}{encode_href(relative)}{tail}{match.group(3)}"

    return MARKDOWN_LINK.sub(rewrite, text)


async def plan_move(root: Path, old: str, new: str, *, folder: bool) -> dict[str, str]:
    """Every file a move of `old` to `new` rewrites, by its path today, and its text after.

    Worked out against the vault as it stands before the move, not after. A
    bare `[[borges]]` is resolved against the listing, and it only names the
    note while the note is still where the links were written to find it. The
    move writes the plan and the preview only counts it.

    `paths` is read once and handed to every note, because resolving a bare
    name needs the full listing, and a folder's move is one pass over many
    notes rather than one pass per note: a link resolved against a listing a
    previous pass had already changed would resolve wrong.

    The trailing slash keeps `readings.md` out of a move of `reading/`: a folder
    is a whole path segment, and a prefix match without it would take the notes
    whose name merely starts the same way.

    rg's answer rather than the whole vault, for the reason search uses rg: a
    scan written here would read every note on every move and hold the event
    loop for all of it. The name is what narrows the read. Every link to the
    thing moving holds it: a bare `[[borges]]` is the name, a path ends in it,
    and a markdown link spells it raw or with its spaces escaped. A folder's
    name narrows the same way, because a path into the folder runs through it.
    The files moving are read whatever they hold, because their own links can
    break by their moving.
    """
    paths = list_markdown_files(root)
    if folder:
        moves = {path: moved(path, old, new) for path in paths if path.startswith(f"{old}/")}
        name = old.rsplit("/", 1)[-1]
    else:
        moves = {old: new}
        name = _name(old)

    candidates = set(moves)
    for needle in {name, encode_href(name)}:
        candidates.update(await notes_holding(root, needle))

    # The pages and assets in a moving folder move with it, and a `[[link]]`
    # that spelled one's path follows. Added after the candidates: a file is
    # read by the browser, never rewritten here. They are in the listing too,
    # or a bare `[[plan.pdf]]` would name nothing a move could take anywhere.
    files = list_html(root) + list_assets(root)
    if folder:
        moves |= {file: moved(file, old, new) for file in files if file.startswith(f"{old}/")}
    else:
        # A note's books go with it, unless their landing is taken, and asking
        # the function the move asks is what keeps a held-back book's links
        # where the book still is.
        books = books_beside(root / old, root / new)
        moves |= {
            book.relative_to(root).as_posix(): to.relative_to(root).as_posix() for book, to in books
        }

    return _plan(root, sorted(candidates), moves, paths + files, (old, new))


def _plan(
    root: Path,
    candidates: list[str],
    moves: dict[str, str],
    paths: list[str],
    move: tuple[str, str],
) -> dict[str, str]:
    """The rewrite of each of `candidates` that changes, read off disk. See `plan_move`."""
    old, new = move
    base = root.resolve()
    plan = {}
    for relative in candidates:
        text = (base / relative).read_text(encoding="utf-8")
        rewritten = relink(text, moves, paths)
        rewritten = relink_markdown(rewritten, relative, moved(relative, old, new), old, new)
        if rewritten != text:
            plan[relative] = rewritten
    return plan


async def relink_move(root: Path, old: str, new: str, *, folder: bool) -> None:
    """Rewrite every link a move of `old` to `new` would break. Call it before the move.

    The paths written to are the ones the files have now. Inside a moving
    folder that is the old one, which is why this runs first: after the rename
    none of them is there.
    """
    _write(root, await plan_move(root, old, new, folder=folder))


def _write(root: Path, plan: dict[str, str]) -> None:
    """Write each text in `plan` over the file at its path."""
    base = root.resolve()
    for relative, text in plan.items():
        write_note(base / relative, text)
