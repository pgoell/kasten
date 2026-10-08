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
Two copies of one rule is the cost of the editor resolving a link without asking
the server, and the tests on both sides describe the same three cases.
"""

import posixpath
import re
from typing import TYPE_CHECKING
from urllib.parse import unquote

from kasten_backend.search import notes_holding
from kasten_backend.vault import (
    HTML_SUFFIX,
    encode_href,
    list_html,
    list_markdown_files,
    write_note,
)

if TYPE_CHECKING:
    from pathlib import Path

SUFFIX = ".md"

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


def link_path(target: str, paths: list[str]) -> str:
    """The vault path `[[target]]` names, whether or not a note is there.

    A target with a slash in it is a path and is taken at its word. A bare name
    is looked for anywhere in the vault, ignoring case, so `[[borges]]` names
    `reading/borges.md` from any note. `paths` arrives sorted, so a note of that
    name at the vault root wins over one in a folder.

    A name nothing answers to comes back as it was written, where the editor's
    copy answers `<inbox>/<name>.md`. That is a rule about where a note is made
    and not about which note a link names: what this feeds is a mapping keyed by
    notes that exist, which a path nothing answers to is not in either way.
    """
    typed = target.strip()
    # A page of HTML is named by its whole file name, so `[[report.html]]` and
    # `[[report]]` are two files.
    path = typed if typed.endswith((SUFFIX, HTML_SUFFIX)) else f"{typed}{SUFFIX}"
    if path in paths or "/" in path:
        return path

    name = path.lower()
    return next((other for other in paths if other.rsplit("/", 1)[-1].lower() == name), path)


def _name(path: str) -> str:
    """The note's name: the last segment, without the suffix."""
    return path.rsplit("/", 1)[-1][: -len(SUFFIX)]


def _respell(target: str, new: str) -> str:
    """`target` written for a note now at `new`, keeping the spelling it had.

    A path stays a path and a name stays a name, which is what leaves
    `[[borges]]` alone when only the folder changed. The `.md` goes either way:
    a link is read the same with or without it, and one spelling is enough. A
    page keeps its `.html`, which is the only thing telling it from a note.
    """
    stem = new.removesuffix(SUFFIX)
    return stem if "/" in target.strip() else stem.rsplit("/", 1)[-1]


def relink(text: str, moves: dict[str, str], paths: list[str]) -> str:
    """`text` with every link naming a note in `moves` naming where it lands.

    A mapping rather than one pair, because a folder's move is one rewrite over
    many notes. Doing it as one pass per note moved would read the vault once
    per note in the subtree, and a link would be resolved against a listing that
    a previous pass had already made wrong.
    """

    def rewrite(match: re.Match[str]) -> str:
        target = match.group(1)
        if not target.strip():
            return match.group(0)

        new = moves.get(link_path(target, paths))
        if new is None:
            return match.group(0)
        return f"[[{_respell(target, new)}]]"

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

    def rewrite(match: re.Match[str]) -> str:
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

    # The pages in a moving folder move with it, and a `[[link]]` that spelled
    # one's path follows. Added after the candidates: a page is read by the
    # browser, never rewritten here.
    pages = list_html(root)
    if folder:
        moves |= {page: moved(page, old, new) for page in pages if page.startswith(f"{old}/")}

    return _plan(root, sorted(candidates), moves, paths + pages, (old, new))


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
