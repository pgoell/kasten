"""Putting a page of HTML into the vault, over the page already there.

`files.store` for the one file a write may replace: an edition an agent rebuilds
the same day lands over the first. Two callers, `POST /agent/files/{path}` with
a `.html` path and the MCP tool `save_file` handed `content`. The cap, the temp
name and the refusals are `files.py`'s, read off the module at each call so a
test lowering the cap reaches this too.
"""

from typing import TYPE_CHECKING

from kasten_backend import files
from kasten_backend.change import vault_change, vault_write
from kasten_backend.vault import relative_path, resolve_html_path

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

PAGE_HEAD_BYTES = 1024
"""How much of a page's head `looks_like_html` reads for its first `<`.

More than `vault.HEAD_BYTES`, because a page may open on blank lines or indentation
where a format's magic sits at byte zero.
"""


def looks_like_html(head: bytes) -> bool:
    """Whether a page's head opens on a tag, after a UTF-8 byte order mark and blank space.

    The page's stand-in for `ASSET_MAGIC`, and like it a usability check and
    never a security one: the policy `GET /api/html` serves every page under is
    what holds a page's script. It catches the mistakes worth catching, a
    markdown note, a PDF or an empty body sent to a `.html` path. A tag rather
    than `<!doctype html`, so a fragment of a page still lands.
    """
    return head.removeprefix(b"\xef\xbb\xbf").lstrip().startswith(b"<")


async def store_page(
    root: Path, path: str, chunks: AsyncIterator[bytes], *, limit: int | None = None
) -> str:
    """Put the page `chunks` yields at `path`, replacing a page already there.

    `store` for the one file an agent may write twice: an edition rebuilt the
    same day lands over the first. The cap and the path checks are `store`'s,
    and the suffix keeps the replace off a note and off a book, which
    `resolve_html_path` answers for `.html` alone. Every refusal leaves the old
    page whole, since nothing touches it before the rename.
    """
    page = resolve_html_path(root, path)
    if page is None:
        raise files.RefusedError(400, "The vault will not take that path")
    relative = relative_path(root, page)
    # A courtesy, like the one in `store`: the rename below refuses a folder
    # too, but only after the whole body has arrived.
    if page.exists() and not page.is_file():
        raise files.RefusedError(409, "Something is already there")

    page.parent.mkdir(parents=True, exist_ok=True)

    # The temp `store` makes and for its reasons, hidden and opened `"xb"`.
    temporary = page.with_name(files.temporary_name(page.name))
    cap = files.ASSET_LIMIT_BYTES if limit is None else limit
    output = temporary.open("xb")
    try:
        with output:
            size = 0
            head = b""
            async for chunk in chunks:
                size += len(chunk)
                if size > cap:
                    raise files.RefusedError(413, files.too_big(cap))
                if len(head) < PAGE_HEAD_BYTES:
                    head = (head + chunk)[:PAGE_HEAD_BYTES]
                output.write(chunk)

        if not looks_like_html(head):
            raise files.RefusedError(400, "That file is not what its name says")

        # A rename and not the link `store` makes, because replacing is the
        # point. It swaps the whole file in one step, so a reader sees the old
        # page or the new one and never half of either, and the jj change it
        # sits in keeps the old one in the vault's history.
        try:
            async with vault_write(), vault_change(root, relative):
                temporary.replace(page)
        except IsADirectoryError as taken:
            # A folder made at the path after the courtesy check above.
            raise files.RefusedError(409, "Something is already there") from taken
    finally:
        temporary.unlink(missing_ok=True)

    return relative
