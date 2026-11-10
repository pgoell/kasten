"""Search takes each hit note's tags from the tag cache, so an unchanged note is parsed once.

A flashcard note of half a megabyte takes a quarter of a second to parse for its
tags, and search answered with every hit note's tags parsed afresh (#1238).
Each test counts the calls to `tags.tags_of`, the one parse every reader
of a note's tags goes through.
"""

import os
from typing import TYPE_CHECKING, Any

from backend.tests.book_files import pdf
from kasten_backend import graph, search_meta, tags, todos
from kasten_backend import vault as on_disk

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from httpx import AsyncClient


def write(vault: Path, path: str, content: bytes | str) -> Path:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        note.write_bytes(content)
    else:
        note.write_text(content, encoding="utf-8")
    return note


def count_parses(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """The text of each note `tags_of` parses from here on, in order."""
    parsed: list[str] = []
    real = tags.tags_of

    def counted(text: str) -> list[str]:
        parsed.append(text)
        return real(text)

    monkeypatch.setattr(tags, "tags_of", counted)
    return parsed


def touch_later(note: Path) -> None:
    """Move the note's modification time on by a second, as an edit within one tick might not."""
    status = note.stat()
    later = status.st_mtime_ns + 1_000_000_000
    os.utime(note, ns=(later, later))


async def search(client: AsyncClient, q: str) -> list[dict[str, Any]]:
    response = await client.get("/api/search", params={"q": q})
    assert response.status_code == 200
    return response.json()


async def test_1238_a1_a_second_search_does_not_parse_an_unchanged_note_again(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(vault, "Kyoto.md", "Kyoto #travel\n")
    parsed = count_parses(monkeypatch)

    first = await search(client, "Kyoto")
    second = await search(client, "Kyoto")

    assert {"tags": [hit["tags"] for hit in first + second], "parses": len(parsed)} == {
        "tags": [["#travel"], ["#travel"]],
        "parses": 1,
    }


async def test_1238_a2_a_changed_note_is_parsed_again(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    note = write(vault, "Kyoto.md", "Kyoto #travel\n")
    parsed = count_parses(monkeypatch)
    counts: list[int] = []

    await search(client, "Kyoto")
    counts.append(len(parsed))
    await search(client, "Kyoto")
    counts.append(len(parsed))
    # The same size, so only the modification time tells the edit apart.
    note.write_text("Kyoto #trains\n", encoding="utf-8")
    touch_later(note)
    (hit,) = await search(client, "Kyoto")
    counts.append(len(parsed))

    assert {"counts": counts, "tags": hit["tags"]} == {"counts": [1, 1, 2], "tags": ["#trains"]}


async def test_1238_i1_an_edit_landing_during_a_search_is_seen_on_the_next_search(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    note = write(vault, "Kyoto.md", "Kyoto #travel\n")
    real = search_meta.read_note

    def edited_after(root: Path, path: str) -> str | None:
        # The edit lands right after the read, once: a stamp taken after the read
        # would then keep the old tags under the new file's stamp.
        monkeypatch.setattr(search_meta, "read_note", real)
        text = real(root, path)
        note.write_text("Kyoto #trains\n", encoding="utf-8")
        touch_later(note)
        return text

    monkeypatch.setattr(search_meta, "read_note", edited_after)
    (first,) = await search(client, "Kyoto")
    (second,) = await search(client, "Kyoto")

    assert [first["tags"], second["tags"]] == [["#travel"], ["#trains"]]


async def test_1238_i2_a_note_that_cannot_be_read_answers_no_tags_and_is_not_cached(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "2026-03-10 Kyoto.md", b"Kyoto #travel \xff\n")

    first = await search(client, "Kyoto")

    assert {
        "answers": [(hit["date"], hit["tags"]) for hit in first],
        "cached": list(on_disk._held.get(("tags", str(vault)), {})),
    } == {"answers": [("2026-03-10", None)], "cached": []}


async def test_1238_i3_search_and_the_written_notes_share_the_parse_of_a_note(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(vault, "2026-03-10 Kyoto.md", "Kyoto #travel\n")
    parsed = count_parses(monkeypatch)

    (hit,) = await search(client, "Kyoto")
    written = await client.get(
        "/api/written/notes", params={"from": "2026-03-01", "to": "2026-03-31"}
    )
    (again,) = await search(client, "Kyoto")

    assert {
        "search": [hit["tags"], again["tags"]],
        "written": [note["tags"] for note in written.json()],
        "parses": len(parsed),
    } == {"search": [["#travel"], ["#travel"]], "written": [["#travel"]], "parses": 1}


async def test_1238_i4_a_file_hit_takes_its_note_tags_from_the_cache(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(vault, "2026-02-14 paper.md", "#research\n")
    write(vault, "2026-02-14 paper.pdf", pdf([["needle"]]))
    parsed = count_parses(monkeypatch)

    first = await search(client, "needle")
    second = await search(client, "needle")

    assert {"tags": [hit["tags"] for hit in first + second], "parses": len(parsed)} == {
        "tags": [["#research"], ["#research"]],
        "parses": 1,
    }


def count_facets(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[str]]:
    """The notes each reader parses from here on: tags, todos and graph."""
    parsed: dict[str, list[str]] = {"tags": [], "todos": [], "graph": []}
    for name, module in (("tags", tags), ("todos", todos), ("graph", graph)):
        real = module._parse

        def counted(path: str, raw: bytes, real: Any = real, name: str = name) -> Any:
            parsed[name].append(path)
            return real(path, raw)

        monkeypatch.setattr(module, "_parse", counted)
    return parsed


async def read_all(client: AsyncClient) -> dict[str, Any]:
    """What `/api/tags`, `/api/todos` and `/api/graph` answer, in a shape a test can compare."""
    found = {}
    for route in ("tags", "todos", "graph"):
        response = await client.get(f"/api/{route}")
        assert response.status_code == 200
        found[route] = response.json()
    graph_answer = found["graph"]
    return {
        "tags": found["tags"],
        "todos": [(hit["path"], hit["line"], hit["text"]) for hit in found["todos"]],
        "nodes": sorted(
            (node["path"], node["type"], node["tags"]) for node in graph_answer["nodes"]
        ),
        "edges": sorted((edge["source"], edge["target"]) for edge in graph_answer["edges"]),
    }


async def test_1758_a_save_parses_the_one_note_for_tags_todos_and_graph(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for index in range(5):
        write(vault, f"Note {index}.md", f"- [ ] task {index} #t{index}\n[[Note {index + 1}]]\n")
    parsed = count_facets(monkeypatch)
    await read_all(client)
    cold = {name: len(paths) for name, paths in parsed.items()}
    await read_all(client)
    warm = {name: len(paths) - cold[name] for name, paths in parsed.items()}

    saved = await client.put("/api/files/Note 2.md", json={"content": "- [ ] new #fresh\n"})
    for paths in parsed.values():
        paths.clear()
    after = await read_all(client)

    assert {"cold": cold, "warm": warm, "saved": saved.status_code, "after": parsed} == {
        "cold": {"tags": 5, "todos": 5, "graph": 5},
        "warm": {"tags": 0, "todos": 0, "graph": 0},
        "saved": 200,
        "after": {"tags": ["Note 2.md"], "todos": ["Note 2.md"], "graph": ["Note 2.md"]},
    }
    assert "#fresh" in after["tags"]
    assert "#t2" not in after["tags"]


async def test_1758_a_note_rewritten_outside_kasten_shows_on_the_next_read(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "Other.md", "x\n")
    note = write(vault, "Plan.md", "- [ ] old #aa\n[[Other]]\n")
    before = await read_all(client)
    status = note.stat()
    # A sync that keeps the size and sets the modification time back, as `rsync -t` does.
    note.write_text("- [ ] new #bb\n[[Gonee]]\n", encoding="utf-8")
    os.utime(note, ns=(status.st_atime_ns, status.st_mtime_ns))
    assert note.stat().st_size == status.st_size

    after = await read_all(client)

    assert {key: (before[key], after[key]) for key in ("tags", "todos", "edges")} == {
        "tags": (["#aa"], ["#bb"]),
        "todos": ([("Plan.md", 1, "- [ ] old #aa")], [("Plan.md", 1, "- [ ] new #bb")]),
        "edges": ([("Plan.md", "Other.md")], [("Plan.md", "Gonee.md")]),
    }


async def test_1758_a_note_added_or_deleted_outside_kasten_joins_or_leaves(
    client: AsyncClient, vault: Path
) -> None:
    gone = write(vault, "Gone.md", "- [ ] gone #gone\n[[Kept]]\n")
    write(vault, "Kept.md", "#kept\n")
    await read_all(client)
    gone.unlink()
    write(vault, "New.md", "- [ ] new #new\n[[Kept]]\n")

    after = await read_all(client)

    assert {
        "tags": after["tags"],
        "todos": after["todos"],
        "edges": after["edges"],
        "held": {kind: sorted(on_disk._held[(kind, str(vault))]) for kind in ("tags", "todos")},
    } == {
        "tags": ["#kept", "#new"],
        "todos": [("New.md", 1, "- [ ] new #new")],
        "edges": [("New.md", "Kept.md")],
        "held": {"tags": ["Kept.md", "New.md"], "todos": ["Kept.md", "New.md"]},
    }


async def test_1758_the_written_notes_leave_the_archive_in_the_tag_cache(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(vault, "2026-03-10 Kyoto.md", "Kyoto #travel\n")
    write(vault, "98 Archive/Old.md", "#old\n")
    await client.get("/api/tags")
    parsed = count_parses(monkeypatch)

    await client.get("/api/written/notes", params={"from": "2026-03-01", "to": "2026-03-31"})
    tags_answer = await client.get("/api/tags")

    assert {"tags": tags_answer.json(), "parses": len(parsed)} == {
        "tags": ["#old", "#travel"],
        "parses": 0,
    }


async def test_1758_a_crlf_note_with_a_fence_under_a_nested_todo_reads_as_before(
    client: AsyncClient, vault: Path
) -> None:
    text = (
        "- [ ] top #a\r\n    - [ ] nested\r\n    ```\r\n    - [ ] fenced #b\r\n    ```\r\n- end\r\n"
    )
    write(vault, "crlf.md", text.encode())
    write(vault, "a b/x.md", "- [ ] spaced\n")
    write(vault, "a/x.md", "- [ ] plain\n")
    write(vault, "a.md", "- [ ] file\n")

    found = await read_all(client)

    assert {"tags": found["tags"], "todos": found["todos"]} == {
        "tags": ["#a"],
        "todos": [
            ("a/x.md", 1, "- [ ] plain"),
            ("a b/x.md", 1, "- [ ] spaced"),
            ("a.md", 1, "- [ ] file"),
            ("crlf.md", 1, "- [ ] top #a"),
            ("crlf.md", 2, "    - [ ] nested"),
        ],
    }


async def test_1758_a_lone_cr_and_a_note_that_is_not_utf8_read_as_before(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "cr.md", b"- [ ] one #cr\r- [ ] two\n[[Target]]\r[[Other]]\n")
    write(vault, "latin.md", b"- [ ] caf\xe9 #latin\n[[Target]]\n")

    found = await read_all(client)

    assert {key: found[key] for key in ("tags", "todos", "edges")} == {
        "tags": ["#cr", "#latin"],
        "todos": [("cr.md", 1, "- [ ] one #cr\r- [ ] two"), ("latin.md", 1, "- [ ] caf� #latin")],
        "edges": [("cr.md", "Other.md"), ("cr.md", "Target.md"), ("latin.md", "Target.md")],
    }


async def test_1758_the_graph_stops_at_its_line_cap(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(vault, "a.md", "[[One]]\n[[Two]]\n")
    write(vault, "b.md", "[[Three]]\n")
    monkeypatch.setattr(graph, "MOST_LINES", 2)

    found = await read_all(client)

    assert found["edges"] == [("a.md", "One.md"), ("a.md", "Two.md")]
