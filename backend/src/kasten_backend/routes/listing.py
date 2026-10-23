"""Routes that list what the vault holds, and the folders and pages it keeps."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings
from kasten_backend.html_page import KASTEN_THEME, serve_page
from kasten_backend.vault import (
    list_assets,
    list_html,
    list_images,
    list_markdown_files,
    resolve_html,
)

router = APIRouter()


class Layout(BaseModel):
    """The folders the editor files into or looks in, each a path from the vault root."""

    inbox: str
    periodic: str
    archive: str
    images: str
    config: str


@router.get("/api/layout")
async def read_layout(settings: Annotated[Settings, Depends(get_settings)]) -> Layout:
    """Name the folders this vault keeps things in, read off the `KASTEN_*_PATH` settings.

    The editor makes notes and images on its own, so it has to know where they
    go. Served rather than built in, so one frontend bundle fits any vault.
    """
    return Layout(
        inbox=settings.inbox_path,
        periodic=settings.periodic_path,
        archive=settings.archive_path,
        images=settings.images_path,
        config=settings.config_path,
    )


@router.get("/api/files")
async def list_files(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """List every note in the vault as a relative POSIX path, sorted.

    The client folds these into a folder tree; the server stays flat.
    """
    return list_markdown_files(settings.vault_path)


@router.get("/api/images")
async def list_vault_images(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """List every image in the vault as a relative POSIX path, sorted.

    Its own listing rather than rows in `/api/files`, which the tree, the finder,
    the search and the link rewrite all read: an image is not a note and has no
    business in any of those. The editor reads this one to complete a `![](`.
    """
    return list_images(settings.vault_path)


@router.get("/api/html")
async def list_vault_html(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """List every HTML page in the vault as a relative POSIX path, sorted.

    Its own listing for the reason the images have theirs: a page is a row of
    the tree and nothing else the notes feed.
    """
    return list_html(settings.vault_path)


@router.get("/api/vault-assets")
async def list_vault_assets(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """List every image and book in the vault as a relative POSIX path, sorted.

    What the editor asks before it draws a `[[plan.pdf]]` as live or dead, so
    the books are in it where `/api/images` leaves them out. Not `/api/assets`,
    whose `GET` with a path serves one file: an empty path there is a 404 for a
    file nobody named, and a listing beside it would be the same URL meaning two
    things.
    """
    return list_assets(settings.vault_path)


HTML_POLICY = "; ".join(
    [
        # An origin of its own that is nobody's, so a script in the page reads no
        # cookie and no storage of kasten's. In the header and not only on the
        # `<iframe>`, so a page opened straight from its address in a tab of its
        # own is held the same way.
        "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
        "default-src 'none'",
        # A research page draws its charts and its slides with inline script, and
        # a CDN library is the other way it gets one.
        "script-src 'unsafe-inline' https:",
        "style-src 'unsafe-inline' https:",
        "img-src 'self' data: blob: https:",
        "font-src data: https:",
        "media-src data: https:",
        # The sandbox stops the page reading kasten, and this stops it writing:
        # a `no-cors` POST to `/api/assets` carries no answer back but lands all
        # the same wherever the browser still sends the cookie.
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
    ]
)
"""What one page of HTML out of the vault may do, which is draw itself."""


@router.get("/api/html/{path:path}", response_class=Response)
async def read_html(
    path: str,
    settings: Annotated[Settings, Depends(get_settings)],
    theme: str | None = None,
    palette: str | None = None,
) -> Response:
    """Read one HTML page out of the vault, to be drawn in a frame and not trusted.

    The page is whatever a research run or a terminal left there, script
    included, and this is kasten's origin. `HTML_POLICY` is what keeps the two
    apart. `theme` and `palette` are the frame's colours for a page that opts in
    with the kasten-theme meta; `serve_page` says what they do.
    """
    page = resolve_html(settings.vault_path, path)
    if page is None:
        raise HTTPException(status_code=404, detail="No such page")

    return Response(
        serve_page(page.read_bytes(), theme, palette),
        media_type="text/html",
        headers={"Content-Security-Policy": HTML_POLICY},
    )


@router.get("/api/kasten-theme.css", response_class=Response)
async def read_kasten_theme() -> Response:
    """Serve the design tokens a page that opts in is given, as a stylesheet.

    The path is stable on purpose: a plugin copies the file at build time, and
    `test_page_theme.py` keeps the copy the same as the frontend's own file.
    """
    return Response(KASTEN_THEME, media_type="text/css")


@router.get("/api/terminals")
async def list_terminals(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """Name every herdr session a terminal pane could attach to, sorted.

    A listing of a directory the shell container owns, and nothing more. herdr
    is not run and the sessions are not touched, so this cannot say which are
    running; a name is enough for the prompt, and `herdr --session` attaches to
    a stopped session and starts a missing one alike.

    An absent directory is not an error. The mount is optional and the shell
    container need not be up for the notebook to work, so the prompt falls back
    to a name typed by hand.
    """
    root = settings.herdr_sessions_path
    if not root.is_dir():
        return []
    return sorted(entry.name for entry in root.iterdir() if entry.is_dir())
