import json
from typing import TYPE_CHECKING, Any

import pytest

from kasten_backend import main

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable, MutableMapping
    from pathlib import Path

    from httpx import AsyncClient

BOOK = b"PK\x03\x04 not really a book"
"""Enough bytes to tell one response from another. Nothing on this path opens one."""


async def test_reads_a_book_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "books").mkdir()
    (vault / "books" / "DDIA.epub").write_bytes(BOOK)

    response = await client.get("/api/assets/books/DDIA.epub")

    assert response.status_code == 200
    assert response.content == BOOK


async def test_reports_a_book_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    response = await client.get("/api/assets/books/missing.epub")

    assert response.status_code == 404


async def test_refuses_a_directory_named_like_a_book(client: AsyncClient, vault: Path) -> None:
    # Without the `is_file` check starlette raises inside `FileResponse.__call__`
    # and the client gets a 500 where it should get a 404.
    (vault / "books").mkdir()
    (vault / "books" / "x.epub").mkdir()

    response = await client.get("/api/assets/books/x.epub")

    assert response.status_code == 404


async def test_refuses_a_note(client: AsyncClient, vault: Path) -> None:
    # The two resolvers cannot be used for each other.
    (vault / "index.md").write_text("# index")

    response = await client.get("/api/assets/index.md")

    assert response.status_code == 404


async def test_refuses_to_climb_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    (vault.parent / "outside.epub").write_bytes(BOOK)

    response = await client.get("/api/assets/%2E%2E%2Foutside.epub")

    assert response.status_code == 404


async def test_refuses_an_absolute_path(client: AsyncClient, vault: Path) -> None:
    (vault.parent / "outside.epub").write_bytes(BOOK)

    response = await client.get(f"/api/assets/{vault.parent}/outside.epub")

    assert response.status_code == 404


async def test_serves_a_roundabout_path_that_stays_inside(client: AsyncClient, vault: Path) -> None:
    # `_resolve_inside` promises containment, not the rejection of spellings, and
    # `books/../DDIA.epub` lands at the vault root rather than inside `books`.
    (vault / "books").mkdir()
    (vault / "DDIA.epub").write_bytes(BOOK)

    response = await client.get("/api/assets/books/%2E%2E%2FDDIA.epub")

    assert response.status_code == 200
    assert response.content == BOOK


async def test_reports_a_missing_vault_rather_than_raising(
    client: AsyncClient, missing_vault: Path
) -> None:
    response = await client.get("/api/assets/books/DDIA.epub")

    assert response.status_code == 404


def counted(*chunks: bytes) -> tuple[AsyncIterator[bytes], list[int]]:
    """A body httpx pulls one chunk at a time, and a list recording how many it pulled.

    `ASGITransport` calls `receive` once per chunk of the iterator it is given
    (`httpx/_transports/asgi.py`), so a generator is the only body shape that
    can tell a refusal reading nothing off the wire from one reading it all.
    A plain `bytes` body arrives as a single chunk and proves neither.
    """
    pulled = [0]

    async def body() -> AsyncIterator[bytes]:
        for chunk in chunks:
            pulled[0] += 1
            yield chunk

    return body(), pulled


async def test_refuses_a_note_path(client: AsyncClient, vault: Path) -> None:
    body, pulled = counted(BOOK)

    response = await client.post("/api/assets/index.md", content=body)

    assert response.status_code == 400
    assert response.json()["detail"] == "The vault will not take that path"
    assert not (vault / "index.md").exists()
    assert pulled == [0]


async def test_refuses_a_post_that_climbs_out(client: AsyncClient, vault: Path) -> None:
    # A guard, not a red step: the resolve above already refuses this. It is
    # here so a later change that resolves the path some other way says so.
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    response = await client.post("/api/assets/%2E%2E%2Foutside.epub", content=BOOK)

    assert response.status_code == 400
    assert not (vault.parent / "outside.epub").exists()


async def test_refuses_a_target_that_is_taken(client: AsyncClient, vault: Path) -> None:
    (vault / "books").mkdir()
    (vault / "books" / "DDIA.epub").write_bytes(BOOK)
    body, pulled = counted(b"PK\x03\x04 a different book")

    response = await client.post("/api/assets/books/DDIA.epub", content=body)

    assert response.status_code == 409
    assert response.json()["detail"] == "Something is already there"
    assert (vault / "books" / "DDIA.epub").read_bytes() == BOOK
    assert pulled == [0]


async def test_refuses_a_body_over_the_cap(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "ASSET_LIMIT_BYTES", 32)
    # Sixteen bytes at a time crosses 32 on the third chunk, so three is the
    # exact number a handler that stops the moment the count passes the cap
    # pulls. "Fewer than twenty" would pass for one that read nineteen first.
    body, pulled = counted(*[b"PK\x03\x04" + b"x" * 12] * 20)

    response = await client.post("/api/assets/books/DDIA.epub", content=body)

    assert response.status_code == 413
    assert response.json()["detail"] == "That book is too big"
    assert pulled == [3]
    assert not (vault / "books" / "DDIA.epub").exists()
    assert list((vault / "books").iterdir()) == []


async def test_refuses_bytes_that_are_not_a_zip(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/assets/books/DDIA.epub", content=b"%PDF-1.4 hello")

    assert response.status_code == 400
    assert response.json()["detail"] == "That file is not what its name says"
    assert not (vault / "books" / "DDIA.epub").exists()
    assert list((vault / "books").iterdir()) == []


async def test_refuses_an_empty_body(client: AsyncClient, vault: Path) -> None:
    # A guard, not a red step: four bytes cannot be compared against a body
    # that has none, so the check above already refuses this. Worth keeping,
    # an empty body being the shape a half-copied file arrives in.
    response = await client.post("/api/assets/books/DDIA.epub", content=b"")

    assert response.status_code == 400
    assert not (vault / "books" / "DDIA.epub").exists()
    assert list((vault / "books").iterdir()) == []


async def test_a_book_lands_and_reads_back(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/assets/books/DDIA.epub", content=BOOK)

    assert response.status_code == 201
    # Empty, which is what the missing response model means: the client
    # computes the sidecar path itself and never reads this answer.
    assert response.content == b""

    read = await client.get("/api/assets/books/DDIA.epub")

    assert read.status_code == 200
    assert read.content == BOOK


async def test_makes_the_folders_on_the_way(client: AsyncClient, vault: Path) -> None:
    # A guard, not a red step: the `mkdir` above already makes them.
    response = await client.post("/api/assets/a/b/c.epub", content=BOOK)

    assert response.status_code == 201
    assert (await client.get("/api/assets/a/b/c.epub")).content == BOOK


async def test_lands_a_roundabout_path_where_the_vault_says(
    client: AsyncClient, vault: Path
) -> None:
    # A guard, not a red step: `_resolve_inside` already canonicalises the
    # path, and it promises containment rather than the rejection of spellings.
    # The read side pins the same rule in
    # `test_serves_a_roundabout_path_that_stays_inside`.
    (vault / "books").mkdir()

    response = await client.post("/api/assets/books/%2E%2E%2FDDIA.epub", content=BOOK)

    assert response.status_code == 201
    assert (vault / "DDIA.epub").read_bytes() == BOOK
    assert not (vault / "books" / "DDIA.epub").exists()


async def post_scripted(path: str, messages: list[dict | Callable[[], None]]) -> list[dict]:
    """Drive the app over ASGI, running a callable in the list rather than sending it.

    Two cases need this and httpx can drive neither: its `ASGITransport` returns
    `http.disconnect` only once the body is exhausted and the response is done,
    and it offers no seam between two chunks. A callable in `messages` is that
    seam. Calling `app` directly still honours `app.dependency_overrides`, so
    the `vault` fixture carries over unchanged.
    """
    target = f"/api/assets/{path}"
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.1"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": target,
        "raw_path": target.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"test")],
        "client": ("127.0.0.1", 1234),
        "server": ("test", 80),
    }
    pending = list(messages)
    sent: list[dict] = []

    async def receive() -> dict:
        while pending:
            message = pending.pop(0)
            if not isinstance(message, dict):
                message()
                continue
            return message
        return {"type": "http.disconnect"}

    async def send(message: MutableMapping[str, Any]) -> None:
        sent.append(dict(message))

    await main.app(scope, receive, send)
    return sent


async def test_leaves_nothing_behind_when_the_client_goes_away(
    client: AsyncClient, vault: Path
) -> None:
    half = len(BOOK) // 2

    sent = await post_scripted(
        "books/DDIA.epub",
        [
            {"type": "http.request", "body": BOOK[:half], "more_body": True},
            {"type": "http.disconnect"},
        ],
    )

    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 499
    assert not (vault / "books" / "DDIA.epub").exists()
    assert list((vault / "books").iterdir()) == []

    # User story 6, and the assertion the whole reservation argument rests on:
    # the path is free again and the next upload takes it.
    again = await client.post("/api/assets/books/DDIA.epub", content=BOOK)

    assert again.status_code == 201
    assert (await client.get("/api/assets/books/DDIA.epub")).content == BOOK


async def test_refuses_a_target_that_appears_while_the_body_streams(vault: Path) -> None:
    # The scripted seam, and the only test that reaches the `os.link`: the
    # `exists()` courtesy short-circuits every other path to it. The two chunks
    # are `BOOK` cut in half rather than invented, because the four-byte check
    # runs first and a body that does not start `PK\x03\x04` answers 400
    # without ever reaching the link.
    half = len(BOOK) // 2
    other = b"PK\x03\x04 the other writer's book"

    def another_writer_lands_one() -> None:
        (vault / "books" / "DDIA.epub").write_bytes(other)

    sent = await post_scripted(
        "books/DDIA.epub",
        [
            {"type": "http.request", "body": BOOK[:half], "more_body": True},
            another_writer_lands_one,
            {"type": "http.request", "body": BOOK[half:], "more_body": False},
        ],
    )

    assert sent[0]["status"] == 409
    assert json.loads(sent[1]["body"])["detail"] == "Something is already there"
    assert (vault / "books" / "DDIA.epub").read_bytes() == other
    assert list((vault / "books").iterdir()) == [vault / "books" / "DDIA.epub"]


@pytest.mark.parametrize(
    "refusal",
    [
        (b"%PDF-1.4 hello", None, 400),
        (b"", None, 400),
        (BOOK, 4, 413),
    ],
    ids=["not a zip", "empty", "over the cap"],
)
async def test_the_next_upload_succeeds_after_a_refusal(
    client: AsyncClient,
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    refusal: tuple[bytes, int | None, int],
) -> None:
    # A guard over behaviour the `finally` already gives, and the most
    # important one here: it is why the reservation design was dropped. The
    # disconnect cannot join this parameterize, httpx returning
    # `http.disconnect` only once the body is exhausted, so
    # `test_leaves_nothing_behind_when_the_client_goes_away` asserts the same
    # four things for it. The taken-path 409 and the two bad-path 400s are
    # deliberately absent: a taken path stays taken and an illegal path stays
    # illegal, so a retry to either cannot succeed.
    body, cap, status = refusal
    before = main.ASSET_LIMIT_BYTES
    if cap is not None:
        monkeypatch.setattr(main, "ASSET_LIMIT_BYTES", cap)

    refused = await client.post("/api/assets/books/DDIA.epub", content=body)

    assert refused.status_code == status
    assert not (vault / "books" / "DDIA.epub").exists()
    assert list((vault / "books").iterdir()) == []

    monkeypatch.setattr(main, "ASSET_LIMIT_BYTES", before)
    again = await client.post("/api/assets/books/DDIA.epub", content=BOOK)

    assert again.status_code == 201
    assert (await client.get("/api/assets/books/DDIA.epub")).content == BOOK


PNG = b"\x89PNG\r\n\x1a\x0a not really an image"
"""The eight bytes a png starts with, which is the longest magic in the table."""


async def test_an_image_lands_and_reads_back(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/assets/99 Misc/shot.png", content=PNG)

    assert response.status_code == 201

    read = await client.get("/api/assets/99 Misc/shot.png")

    assert read.status_code == 200
    assert read.content == PNG
    assert read.headers["content-type"] == "image/png"


async def test_refuses_an_image_whose_bytes_are_a_book(client: AsyncClient, vault: Path) -> None:
    # The magic is picked by the suffix, so a name and a body that disagree are
    # refused whichever way round they disagree.
    response = await client.post("/api/assets/shot.png", content=BOOK)

    assert response.status_code == 400
    assert response.json()["detail"] == "That file is not what its name says"
    assert not (vault / "shot.png").exists()


async def test_refuses_a_suffix_the_table_does_not_hold(client: AsyncClient, vault: Path) -> None:
    # An svg is markup a browser runs, and the table is what keeps it out.
    response = await client.post("/api/assets/shot.svg", content=b"<svg/>")

    assert response.status_code == 400
    assert response.json()["detail"] == "The vault will not take that path"
    assert not (vault / "shot.svg").exists()


async def test_takes_a_jpeg_whose_magic_is_shorter_than_the_head(
    client: AsyncClient, vault: Path
) -> None:
    # Three bytes against a head of eight, so this is what says the comparison
    # is a prefix rather than the whole of what was read.
    response = await client.post("/api/assets/shot.jpg", content=b"\xff\xd8\xff and the rest")

    assert response.status_code == 201


async def test_lists_the_images_in_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "99 Misc").mkdir()
    (vault / "99 Misc" / "shot.png").write_bytes(PNG)
    (vault / "note.md").write_text("# note")
    (vault / "DDIA.epub").write_bytes(BOOK)

    response = await client.get("/api/images")

    # The note and the book both sit out: the listing is what a `![](` completes
    # against, and neither is an image.
    assert response.status_code == 200
    assert response.json() == ["99 Misc/shot.png"]


async def test_takes_an_image_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "99 Misc").mkdir()
    (vault / "99 Misc" / "shot.png").write_bytes(PNG)

    response = await client.delete("/api/assets/99 Misc/shot.png")

    assert response.status_code == 200
    assert response.json()["path"] == "99 Misc/shot.png"
    assert not (vault / "99 Misc" / "shot.png").exists()
    # The folder goes with it, the way a note's delete takes the one it emptied.
    assert not (vault / "99 Misc").exists()
    assert (await client.get("/api/assets/99 Misc/shot.png")).status_code == 404


async def test_puts_a_deleted_image_back(client: AsyncClient, vault: Path) -> None:
    # The restore has no rule of its own for an image: the entry says where it
    # came from, and `resolve_folder_path` takes any legal path.
    (vault / "shot.png").write_bytes(PNG)
    deleted = await client.delete("/api/assets/shot.png")

    response = await client.patch(f"/api/trash/{deleted.json()['entry']}")

    assert response.status_code == 200
    assert (vault / "shot.png").read_bytes() == PNG
    assert (await client.get("/api/assets/shot.png")).status_code == 200


async def test_refuses_to_delete_a_book(client: AsyncClient, vault: Path) -> None:
    # A book travels with the note beside it, and this route decides nothing
    # about that pair.
    (vault / "DDIA.epub").write_bytes(BOOK)

    response = await client.delete("/api/assets/DDIA.epub")

    assert response.status_code == 404
    assert response.json()["detail"] == "No such image"
    assert (vault / "DDIA.epub").exists()


async def test_reports_deleting_an_image_that_is_not_there(
    client: AsyncClient, vault: Path
) -> None:
    response = await client.delete("/api/assets/99 Misc/missing.png")

    assert response.status_code == 404


async def test_refuses_to_delete_a_note_through_the_asset_route(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.delete("/api/assets/index.md")

    assert response.status_code == 404
    assert (vault / "index.md").exists()
