"""Pointing `[[wikilinks]]` and markdown links at a note that has moved.

A bare `[[name]]` follows its note between folders; a spelled-out path does not. The rule a
target is read by is the frontend's `wikiLinkPath`. Both copies run the cases in
`backend/tests/fixtures/link_paths.json`, so they cannot drift.
"""

import posixpath
import re
from typing import TYPE_CHECKING, NamedTuple
from urllib.parse import quote, unquote

from kasten_backend.code_spans import WIKILINK, code_spans, inside
from kasten_backend.folders import encode_href
from kasten_backend.search import notes_holding
from kasten_backend.vault import (
    ASSET_MAGIC,
    HTML_SUFFIX,
    books_beside,
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

MARKDOWN_LINK = re.compile(r'(!?\[[^\]\n]*\]\()([^)\s]+)((?:\s+"[^"\n]*")?\))')
"""One `[text](href)` or `![alt](href)`, with an optional title after the href.

The href holds no space, so the index guide asks for `%20`: a raw space ends the link for
every reader.
"""

SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
"""An href that names a place outside the vault: `https:`, `mailto:` and the rest."""


class Target(NamedTuple):
    """What `[[name#heading|alias]]` is made of: the note, its heading, and the link's words."""

    name: str
    heading: str | None
    alias: str | None


def split_target(target: str) -> Target:
    """`target` taken apart the way the editor's `splitTarget` takes it.

    The bar is taken first, so an alias may carry a hash or a slash. An empty name is a link to a
    heading of the note it sits in. In a table a bare bar ends the cell, so the backslash before it
    is the table's, not the name's.
    """
    named, bar, alias = target.partition("|")
    if bar:
        named = named.removesuffix("\\")
    name, _, heading = named.partition("#")
    return Target(name.strip(), heading.strip() or None, alias.strip() or None)


def names_a_file(name: str) -> bool:
    """Whether a link's name, already split, names a page or an asset rather than a note.

    Ignoring case, as a bare name is looked up. Only the last segment counts, so a folder with a
    dot in it names no file.
    """
    return name.rsplit("/", 1)[-1].lower().endswith(FILE_SUFFIXES)


def named_path(name: str) -> str:
    """The path a link's name spells: the file as written, or the note with `.md` on.

    The one rule `link_path` and the graph's `resolver` both read, so a rename follows the note the
    graph draws.
    """
    if names_a_file(name) or name.endswith(SUFFIX):
        return name
    return f"{name}{SUFFIX}"


def link_path(target: str, paths: list[str]) -> str:
    """The vault path `[[target]]` names, whether or not a note is there.

    Only the name counts, so `[[borges#Ficciones|his]]` names what `[[borges]]` does. A bare name is
    looked for anywhere in the vault, ignoring case, with a root note winning over a folder's.
    A name nothing answers to comes back as written.
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

    A path stays a path and a name a name, so `[[borges]]` is left alone when only the folder
    changed. The `.md` goes either way; a page keeps its `.html`, which tells it from a note.
    """
    stem = new.removesuffix(SUFFIX)
    return stem if "/" in name else stem.rsplit("/", 1)[-1]


def relink(text: str, moves: dict[str, str], paths: list[str]) -> str:
    """`text` with every link naming a note in `moves` naming where it lands.

    A mapping, not one pair, so a folder's move is one rewrite over many notes. Note by note,
    each pass would read the vault again and resolve links against a listing a previous pass had
    made wrong.
    """
    code = code_spans(text)

    def rewrite(match: re.Match[str]) -> str:
        if inside(match.start(), code):
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


def markdown_target(href: str, here: str, *, embed: bool = False) -> str | None:
    """The vault path `href` names from a file in folder `here`, or None.

    An embed, `![](href)`, is read from the vault root, as the editor draws it. A plain link is
    read from `here`. An href that climbs above the root is None.
    """
    split = _split(href)
    if split is None:
        return None

    path = unquote(split[0])
    target = posixpath.normpath(path if embed else posixpath.join(here, path))
    if target == ".." or target.startswith("../"):
        return None
    return target


def relink_markdown(
    text: str,
    before: str,
    after: str,
    move: tuple[str, str],
    *,
    moves: dict[str, str] | None = None,
) -> str:
    """`text`, held by the file at `before` and soon at `after`, with `move`'s `old` at `new`.

    A relative link is rewritten when its target or its file moves to another folder, but not when
    both move together. An embed is read from the vault root, so only its target matters. `moves`
    holds where each file lands, where that differs from `moved`.
    """
    old, new = move
    here = posixpath.dirname(before)
    there = posixpath.dirname(after)
    code = code_spans(text)

    def rewrite(match: re.Match[str]) -> str:
        if inside(match.start(), code):
            return match.group(0)
        href = match.group(2)
        embed = match.group(1).startswith("!")
        target = markdown_target(href, here, embed=embed)
        if target is None:
            return match.group(0)

        landed = (moves or {}).get(target, moved(target, old, new))
        if landed == target and (embed or here == there):
            return match.group(0)

        written, tail = _split(href) or (href, "")
        relative = landed if embed else posixpath.relpath(landed, there or ".")
        if unquote(written).endswith("/"):
            relative = f"{relative}/"
        if written.startswith("./") and not relative.startswith("."):
            relative = f"./{relative}"
        return f"{match.group(1)}{encode_href(relative)}{tail}{match.group(3)}"

    return MARKDOWN_LINK.sub(rewrite, text)


async def plan_move(root: Path, old: str, new: str, *, folder: bool) -> dict[str, str]:
    """Every file a move of `old` to `new` rewrites, by its path today, and its text after.

    Planned against the vault as it stands: a bare `[[borges]]` names its note only where it is
    now. The `old/` prefix keeps `readings.md` out of a move of `reading`.
    """
    paths = list_markdown_files(root)
    if folder:
        moves = {path: moved(path, old, new) for path in paths if path.startswith(f"{old}/")}
        name = old.rsplit("/", 1)[-1]
    else:
        moves = {old: new}
        name = _name(old)

    # The editor writes links with encodeURI, so `Bücher` arrives as `B%C3%BCcher`, which
    # neither the raw name nor `encode_href` finds. These are the characters encodeURI keeps
    # and `quote` escapes.
    uri = quote(name, safe=";,/?:@&=+$!*'()#").replace("#", "%23").replace("?", "%3F")
    candidates = set(moves)
    for needle in {name, encode_href(name), uri}:
        candidates.update(await notes_holding(root, needle))

    # Pages and assets in a moving folder move with it, and a `[[link]]` spelling one's path
    # follows. They join after the candidates, since a bare `[[plan.pdf]]` must name them.
    files = list_html(root) + list_assets(root)
    if folder:
        moves |= {file: moved(file, old, new) for file in files if file.startswith(f"{old}/")}
    else:
        # A note's books go with it, unless their landing is taken. Asking the function the
        # move asks keeps a held-back book's links where the book still is.
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
        rewritten = relink_markdown(
            rewritten, relative, moved(relative, old, new), move, moves=moves
        )
        if rewritten != text:
            plan[relative] = rewritten
    return plan


async def relink_move(root: Path, old: str, new: str, *, folder: bool) -> None:
    """Rewrite every link a move of `old` to `new` would break. Call it before the move.

    The paths written are the ones the files have now: inside a moving folder, the old ones.
    """
    _write(root, await plan_move(root, old, new, folder=folder))


def _write(root: Path, plan: dict[str, str]) -> None:
    """Write each text in `plan` over the file at its path."""
    base = root.resolve()
    for relative, text in plan.items():
        write_note(base / relative, text)
