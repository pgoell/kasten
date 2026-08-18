"""What a token holder may do to the vault, and what the answers say."""

import hashlib
from typing import TYPE_CHECKING

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from httpx import AsyncClient


def sha(text: str) -> str:
    """The digest the routes report, taken over the bytes as they land on disk."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def test_read_returns_content_and_its_digest(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "index.md").write_text("# index\n")

    response = await client.get("/agent/notes/index.md", headers=bearer)

    assert response.status_code == 200
    assert response.json() == {
        "path": "index.md",
        "content": "# index\n",
        "sha": sha("# index\n"),
    }


async def test_read_preserves_crlf(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # `vault.read_note` is `read_text`, which translates every CRLF to an LF. A
    # translated read would hand back a `content` whose digest is not the `sha`
    # beside it, and a round trip would rewrite every line of the note.
    (agent_vault / "windows.md").write_bytes(b"# one\r\n\r\n# two\r\n")

    response = await client.get("/agent/notes/windows.md", headers=bearer)

    assert response.json()["content"] == "# one\r\n\r\n# two\r\n"
    assert response.json()["sha"] == sha("# one\r\n\r\n# two\r\n")


async def test_read_refuses_a_path_out_of_the_vault(
    client: AsyncClient, bearer: dict[str, str]
) -> None:
    # Percent-encoded, because httpx normalises a literal `../../etc/passwd`
    # before it reaches FastAPI and that form would only prove some other route
    # is missing.
    response = await client.get("/agent/notes/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd", headers=bearer)

    assert response.status_code == 404


async def test_list_returns_every_note_sorted(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "projects").mkdir()
    (agent_vault / "projects" / "kasten.md").write_text("# kasten")
    (agent_vault / "index.md").write_text("# index")

    response = await client.get("/agent/notes", headers=bearer)

    assert response.status_code == 200
    assert response.json() == ["index.md", "projects/kasten.md"]


async def test_list_filters_by_folder(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "projects").mkdir()
    (agent_vault / "projects" / "kasten.md").write_text("# kasten")
    (agent_vault / "index.md").write_text("# index")

    response = await client.get("/agent/notes", params={"folder": "projects"}, headers=bearer)

    assert response.json() == ["projects/kasten.md"]


async def test_list_of_a_folder_outside_the_vault_is_empty(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # Absent rather than refused, the way every other escape reads.
    (agent_vault / "index.md").write_text("# index")

    response = await client.get("/agent/notes", params={"folder": "../.."}, headers=bearer)

    assert response.json() == []


async def test_search_finds_a_line(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n\nThe garden of forking paths.\n")

    response = await client.get("/agent/search", params={"q": "forking"}, headers=bearer)

    assert response.status_code == 200
    assert response.json() == [
        {"path": "borges.md", "line": 3, "text": "The garden of forking paths."}
    ]


async def test_search_honours_the_archive_setting(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # The folder comes off the setting rather than a literal `98 Archive`, which
    # is one vault's filing convention and not kasten's.
    monkeypatch.setenv("KASTEN_ARCHIVE_PATH", "old")
    get_settings.cache_clear()
    (agent_vault / "old").mkdir()
    (agent_vault / "old" / "borges.md").write_text("The garden of forking paths.\n")

    assert (await client.get("/agent/search", params={"q": "forking"}, headers=bearer)).json() == []

    found = await client.get(
        "/agent/search", params={"q": "forking", "archive": True}, headers=bearer
    )

    assert [hit["path"] for hit in found.json()] == ["old/borges.md"]


async def test_save_creates_when_sha_is_null(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.put(
        "/agent/notes/daily/2026-08-18.md", json={"content": "# today"}, headers=bearer
    )

    assert response.status_code == 200
    assert (agent_vault / "daily" / "2026-08-18.md").read_text().endswith("# today")


async def test_save_refuses_a_null_sha_on_an_existing_note(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")

    response = await client.put(
        "/agent/notes/borges.md", json={"content": "# gone"}, headers=bearer
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "The note changed since you read it"
    assert response.json()["current"] == sha("# borges\n")
    assert (agent_vault / "borges.md").read_text() == "# borges\n"


async def test_save_refuses_a_sha_on_an_absent_note(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # `current` is null in exactly this case: a digest was presented for a note
    # that does not exist, so there is no current one to hand back.
    response = await client.put(
        "/agent/notes/absent.md", json={"content": "# new", "sha": sha("# new")}, headers=bearer
    )

    assert response.status_code == 409
    assert response.json()["current"] is None
    assert not (agent_vault / "absent.md").exists()


async def test_save_refuses_a_stale_sha_and_returns_the_current_one(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n")
    read = (await client.get("/agent/notes/borges.md", headers=bearer)).json()
    (agent_vault / "borges.md").write_text("# edited in the browser\n")

    response = await client.put(
        "/agent/notes/borges.md",
        json={"content": "# from the agent", "sha": read["sha"]},
        headers=bearer,
    )

    assert response.status_code == 409
    fresh = (await client.get("/agent/notes/borges.md", headers=bearer)).json()
    assert response.json()["current"] == fresh["sha"]


async def test_saved_sha_is_of_what_landed_not_of_what_was_sent(
    client: AsyncClient, bearer: dict[str, str]
) -> None:
    # `stamp` rewrites `modified`, so the bytes written are never the bytes
    # sent. A caller that computed its next digest locally would be refused
    # forever.
    response = await client.put(
        "/agent/notes/borges.md", json={"content": "# borges"}, headers=bearer
    )

    assert response.json()["sha"] != sha("# borges")
    assert response.json()["sha"] == sha(response.json()["content"])


async def test_a_reserved_name_is_not_stamped(client: AsyncClient, bearer: dict[str, str]) -> None:
    # `index.md` and `log.md` get no block at all, so their bytes are exactly
    # what was sent and the digest of the two agree.
    response = await client.put(
        "/agent/notes/index.md", json={"content": "# index\n"}, headers=bearer
    )

    assert response.json()["content"] == "# index\n"
    assert response.json()["sha"] == sha("# index\n")


async def test_the_returned_sha_is_accepted_on_the_next_save(
    client: AsyncClient, bearer: dict[str, str]
) -> None:
    first = await client.put("/agent/notes/borges.md", json={"content": "# once"}, headers=bearer)

    second = await client.put(
        "/agent/notes/borges.md",
        json={"content": "# twice", "sha": first.json()["sha"]},
        headers=bearer,
    )

    assert second.status_code == 200


async def test_save_preserves_crlf(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # `stamp` rebuilds the file with `"\n".join(...)`, so passing CRLF text
    # through it would destroy every line ending in the note beside the one
    # field the save was for.
    block = "---\r\nid: 019\r\ncreated: 2026-08-01T00:00:00+00:00\r\ntype: Note\r\n"
    (agent_vault / "windows.md").write_bytes(
        (block + "modified: 2026-08-01T00:00:00+00:00\r\n---\r\n\r\n# one\r\n").encode()
    )
    read = (await client.get("/agent/notes/windows.md", headers=bearer)).json()

    response = await client.put(
        "/agent/notes/windows.md",
        json={"content": read["content"], "sha": read["sha"]},
        headers=bearer,
    )

    assert response.status_code == 200
    landed = (agent_vault / "windows.md").read_bytes()
    assert b"\n" in landed
    assert landed.replace(b"\r\n", b"\n").count(b"\n") == landed.count(b"\r\n")
    assert landed.endswith(b"\r\n\r\n# one\r\n")


async def test_append_creates_with_no_leading_blank_line(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # `create_note(note, stamp(text))`, the call `POST /api/files` makes, rather
    # than an empty note appended to, which would put a blank line between the
    # block and the first word.
    response = await client.post(
        "/agent/notes/inbox.md/append", json={"text": "The first line."}, headers=bearer
    )

    assert response.status_code == 200
    assert (agent_vault / "inbox.md").read_text().endswith("---\nThe first line.")


async def test_append_joins_with_exactly_one_blank_line(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "inbox.md").write_text("---\ntype: Note\n---\n\nThe first line.\n")

    response = await client.post(
        "/agent/notes/inbox.md/append", json={"text": "The second line."}, headers=bearer
    )

    assert response.status_code == 200
    assert (agent_vault / "inbox.md").read_text().endswith("The first line.\n\nThe second line.\n")


async def test_append_without_a_sha_is_race_free(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # `sha` is optional on an append and checked when given: the read and the
    # write happen under one acquisition of the write lock, so nothing can
    # change the note in between.
    (agent_vault / "inbox.md").write_text("---\ntype: Note\n---\n\nOne.\n")

    for line in ("Two.", "Three."):
        assert (
            await client.post("/agent/notes/inbox.md/append", json={"text": line}, headers=bearer)
        ).status_code == 200

    assert (agent_vault / "inbox.md").read_text().endswith("One.\n\nTwo.\n\nThree.\n")


async def test_a_write_whose_result_exceeds_the_bound_is_refused(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # The bound is on the bytes that would land, after the join and after the
    # stamp. Bounding the incoming text alone would let a note just under the
    # line plus a small append cross it.
    (agent_vault / "big.md").write_text("x" * (1024 * 1024 - 64))

    response = await client.post(
        "/agent/notes/big.md/append", json={"text": "y" * 256}, headers=bearer
    )

    assert response.status_code == 413
    assert (agent_vault / "big.md").read_text() == "x" * (1024 * 1024 - 64)


async def test_the_schema_needs_a_token(client: AsyncClient, agent_vault: Path) -> None:
    # Gated by the router's own dependency, not by the MCP mount below it, which
    # would answer 401 for an unmatched path and make this pass either way.
    assert str(agent_vault)

    response = await client.get("/agent/openapi.json")

    assert response.status_code == 401


async def test_the_schema_describes_the_agent_routes(
    client: AsyncClient, bearer: dict[str, str]
) -> None:
    response = await client.get("/agent/openapi.json", headers=bearer)

    assert response.status_code == 200
    assert set(response.json()["paths"]) == {
        "/agent/notes",
        "/agent/notes/{path}",
        "/agent/notes/{path}/append",
        "/agent/search",
        "/agent/openapi.json",
    }


async def test_the_schema_names_no_route_a_token_cannot_reach(
    client: AsyncClient, bearer: dict[str, str]
) -> None:
    # The point of the prefix is that the audit is a list of five things. A
    # schema handing a token holder the map of the twenty-seven routes it cannot
    # reach would give that away for nothing.
    schema = (await client.get("/agent/openapi.json", headers=bearer)).json()

    assert not [path for path in schema["paths"] if not path.startswith("/agent/")]
    assert "TrashEntry" not in schema.get("components", {}).get("schemas", {})
