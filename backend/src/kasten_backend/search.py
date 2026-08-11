"""Finding a word in the vault, by reading the vault.

Nothing is indexed. ripgrep walks the notes on every query, which at 10,000
notes costs under 20ms and cannot go stale, because the files it reads are the
source of truth themselves. That is the whole reason this does not touch
Postgres.

The subprocess is not only about speed. A scan written in Python holds the
event loop for as long as it runs; this one holds it for none of it.
"""

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple, cast

if TYPE_CHECKING:
    from collections.abc import Sequence

MOST_HITS = 2_000
"""How many matching lines come back at most.

Not a limit the machine needs. ripgrep reads the whole 10,000 note vault in
about 17ms whatever the cap, so this is about what crosses the wire and what
the client then ranks: 2,000 lines is roughly 160KB per keystroke, and 5,000
would be 400KB for an answer nobody scrolls to the end of.

It is deliberately far above what the finder shows. The client ranks every line
it is handed and cuts afterwards, so the rows on screen are the best of the
match set rather than the first slice of it, and a cap this size is the whole
match set for anything but the most common word in the vault.
"""


class Hit(NamedTuple):
    """One matching line: where it lives, which line it is, and what it says."""

    path: str
    line: int
    text: str


# Flags both readers below pass, so the two cannot drift into disagreeing about
# which notes the vault holds. `--no-ignore` because the vault may be a git repo
# and a `.gitignore` in it says nothing about which notes exist. The glob
# because the listing is markdown only. Hidden files need no flag: rg skips
# them, and so does the listing, which keeps `.jj` and `.git` out of both.
SEEN_BY_THE_LISTING = ("--no-ignore", "--glob", "*.md")


def skipping(folder: str | None) -> tuple[str, ...]:
    """The flags that keep a folder out of a scan, or none at all.

    The leading `**/` is not decoration. rg matches a glob against the path it
    prints, and the scans below hand it the vault as an absolute path, so a
    pattern anchored the gitignore way, `98 Archive/**`, is matched against
    `/home/pascal/kasten-data/vault/98 Archive/old.md` and never fires. The
    absolute path cannot be built into the glob instead: a vault living under a
    directory whose name holds `[`, `*` or `?` would turn into a pattern that
    means something else.

    So this is unanchored, and the cost is stated rather than hidden: a folder
    of this name nested anywhere in the vault is skipped too, not only the one
    at the top. For a filing convention that is the wanted reading, and
    `98 Archived plans` is untouched either way because a path component has to
    match the name whole.

    It goes after `SEEN_BY_THE_LISTING`, where rg's last-match-wins rule lets a
    negation overrule the `*.md` whitelist in front of it.

    Note what this is not applied to: `notes_holding` below, which is what a
    move reads to find the notes naming what moved. An archived note holding a
    link is still a link to rewrite, and skipping it there would leave a broken
    one behind. Leaving a folder out of a search is a convenience; leaving it
    out of a rewrite is data loss.
    """
    return () if folder is None or folder == "" else ("--glob", f"!**/{folder}/**")


class SearchError(RuntimeError):
    """rg could not read the whole vault, so its answer is not the whole answer.

    Raised only for the caller that rewrites notes. A search that came up short
    shows fewer rows; a rewrite that comes up short leaves a broken link behind,
    and it has to fail instead.
    """


async def notes_holding(root: Path, text: str) -> list[str]:
    """Every note in the vault whose text contains `text`, ignoring case.

    Paths only, one per note rather than one per matching line, which is what
    lets this have no cap where `search_vault` needs one: a caller about to
    rewrite the vault has to be handed every note or it leaves a link pointing
    at nothing.

    A literal match, and a superset of what the caller is really after. It
    narrows a walk over every note in the vault to a walk over the few that
    could hold the link, and the caller still decides note by note.
    """
    process = await asyncio.create_subprocess_exec(
        "rg",
        "--files-with-matches",
        "--fixed-strings",
        "--ignore-case",
        # One NUL after each path, which is the one byte a path cannot contain.
        # A newline can, and splitting on one would cut such a path in half.
        "--null",
        *SEEN_BY_THE_LISTING,
        "-e",
        text,
        "--",
        str(root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()

    # 0 is matches and 1 is none. Anything above that is rg saying it could not
    # read part of the vault, which for this caller is not an empty answer.
    if process.returncode is not None and process.returncode > 1:
        raise SearchError(stderr.decode(errors="replace").strip())

    found = stdout.decode("utf-8", "replace").split("\0")
    return [str(Path(path).relative_to(root)) for path in found if path]


async def scan_vault(
    root: Path, matcher: Sequence[str], cap: int, skip: str | None = None
) -> list[Hit]:
    """Every line rg matches, up to `cap`. `matcher` carries the pattern and its flags.

    Every reader of lines goes through here, so the two cannot drift into
    reporting a hit differently. What a reader chooses is the pattern, how it is
    read and how many lines it is worth waiting for; everything else about the
    scan is the same question asked of the same vault.

    A vault that is not there needs no guard. rg says so on stderr and writes
    nothing to stdout, which arrives here as no matches, and asking the
    filesystem first would only be a blocking call on the way to the same answer.
    """
    process = await asyncio.create_subprocess_exec(
        "rg",
        "--line-number",
        "--with-filename",
        "--no-heading",
        "--null",
        # A reader has to see exactly what `GET /api/files` lists, and these are
        # where rg would otherwise disagree with it.
        *SEEN_BY_THE_LISTING,
        *skipping(skip),
        *matcher,
        # `--` so a path starting with a dash is a path and not a flag.
        "--",
        str(root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    hits = []
    # `stdout=PIPE` above is what makes this a reader and not None, which the
    # type checker cannot see from here.
    stdout = cast("asyncio.StreamReader", process.stdout)
    async for raw in stdout:
        # `--null` puts a NUL after the filename, which is the one byte a path
        # cannot contain. Splitting on the colon alone would break on any note
        # whose name has one.
        path, _, rest = raw.decode("utf-8", "replace").rstrip("\n").partition("\0")
        number, _, text = rest.partition(":")
        hits.append(Hit(path=str(Path(path).relative_to(root)), line=int(number), text=text))
        if len(hits) == cap:
            break

    # Counted here rather than handed to `--max-count`, which counts per file
    # and would take the cap from every note separately. Reaching it means rg
    # is still scanning for matches nobody asked for, so it is stopped rather
    # than waited out.
    if process.returncode is None:
        process.kill()
    await process.wait()
    return hits


async def search_vault(root: Path, query: str, skip: str | None = None) -> list[Hit]:
    """Every line in the vault containing `query`, ignoring case, up to `MOST_HITS`.

    `skip` names a folder to walk past, which is how the archive stays out of a
    search by default. It matters more here than it looks: `MOST_HITS` caps what
    comes back, so an archive that grows without bound would eventually crowd
    live notes out of the answer rather than merely padding it.
    """
    # An empty literal matches every line there is, so the query that has not
    # been typed yet would be the most expensive one the vault can answer.
    if not query.strip():
        return []

    # A literal, so `index.` finds the end of a sentence and a half-typed
    # `[[like` is a query rather than an error. Nothing here is a regex, and the
    # client is what makes the result feel fuzzy. `-e` so a query starting with
    # a dash is a query and not a flag.
    matcher = ("--fixed-strings", "--ignore-case", "-e", query)
    return await scan_vault(root, matcher, MOST_HITS, skip)
