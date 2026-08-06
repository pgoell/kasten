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
from typing import NamedTuple, cast

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


async def search_vault(root: Path, query: str) -> list[Hit]:
    """Every line in the vault containing `query`, ignoring case, up to `MOST_HITS`."""
    # An empty literal matches every line there is, so the query that has not
    # been typed yet would be the most expensive one the vault can answer.
    #
    # A vault that is not there needs no guard of its own. rg says so on stderr
    # and writes nothing to stdout, which arrives here as no matches, and
    # asking the filesystem first would only be a blocking call on the way to
    # the same answer.
    if not query.strip():
        return []

    process = await asyncio.create_subprocess_exec(
        "rg",
        # A literal, so `index.` finds the end of a sentence and a half-typed
        # `[[like` is a query rather than an error. Nothing here is a regex,
        # and the client is what makes the result feel fuzzy.
        "--fixed-strings",
        "--ignore-case",
        "--line-number",
        "--with-filename",
        "--no-heading",
        "--null",
        # Search has to see exactly what `GET /api/files` lists, and these two
        # are where rg would otherwise disagree with it. `--no-ignore` because
        # the vault may be a git repo and a `.gitignore` in it says nothing
        # about which notes exist. The glob because the listing is markdown
        # only. Hidden files need no flag: rg skips them, and so does the
        # listing, which is what keeps `.jj` and `.git` out of both.
        "--no-ignore",
        "--glob",
        "*.md",
        # `-e` so a query starting with a dash is a query and not a flag, and
        # `--` so the same is true of the path after it.
        "-e",
        query,
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
        if len(hits) == MOST_HITS:
            break

    # Counted here rather than handed to `--max-count`, which counts per file
    # and would take the cap from every note separately. Reaching it means rg
    # is still scanning for matches nobody asked for, so it is stopped rather
    # than waited out.
    if process.returncode is None:
        process.kill()
    await process.wait()
    return hits
