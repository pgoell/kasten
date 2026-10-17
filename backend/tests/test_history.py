import asyncio
from datetime import datetime
from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest import JJ, jj
from kasten_backend import history

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

pytestmark = pytest.mark.skipif(JJ is None, reason="jj is not installed")


def commit_of(vault: Path, revision: str) -> str:
    return jj(
        vault, "--ignore-working-copy", "log", "-r", revision, "--no-graph", "-T", "commit_id"
    )


def op_count(vault: Path) -> int:
    # `--ignore-working-copy`, or the counting would itself add an operation.
    log = jj(vault, "--ignore-working-copy", "op", "log", "--no-graph", "-T", '"x\\n"')
    return len(log.splitlines())


async def test_lists_the_changes_to_a_note_newest_first(
    client: AsyncClient, versioned_vault: Path
) -> None:
    await client.post("/api/files/index.md")
    await client.post("/api/files/other.md")
    await client.put("/api/files/index.md", json={"content": "# edited\n"})

    response = await client.get("/api/history", params={"path": "index.md"})

    assert response.status_code == 200
    body = response.json()
    assert body["versioned"] is True
    assert [change["commit"] for change in body["changes"]] == [
        commit_of(versioned_vault, "@"),
        commit_of(versioned_vault, "@--"),
    ]
    for change in body["changes"]:
        assert change["description"] == "vault: index.md"
        assert change["path"] == "index.md"
        assert datetime.fromisoformat(change["time"]).tzinfo is not None
        assert change["change"]


async def test_follows_the_note_back_through_a_move(
    client: AsyncClient, versioned_vault: Path
) -> None:
    await client.post("/api/files/borges.md")
    await client.put("/api/files/borges.md", json={"content": "# the old name\n"})
    await client.patch("/api/files/borges.md", json={"path": "reading/borges.md"})

    response = await client.get("/api/history", params={"path": "reading/borges.md"})

    changes = response.json()["changes"]
    assert [change["path"] for change in changes] == ["reading/borges.md", "borges.md"]
    assert changes[1]["commit"] == commit_of(versioned_vault, "@-")
    old = await client.get(
        "/api/history/version", params={"path": "borges.md", "commit": changes[1]["commit"]}
    )
    assert old.status_code == 200
    assert old.json()["content"].endswith("# the old name\n")


async def test_does_not_follow_a_note_removed_beside_this_one(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # A note made while another was deleted in the shell is no move. Followed,
    # this note would take the other's history, and a restore would write its text.
    (versioned_vault / "apple.md").write_text("# apples grow on trees\n")
    jj(versioned_vault, "commit", "-m", "apple")
    (versioned_vault / "apple.md").unlink()
    (versioned_vault / "cello.md").write_text("# a cello has four strings\n")
    jj(versioned_vault, "commit", "-m", "cello")

    response = await client.get("/api/history", params={"path": "cello.md"})

    assert [change["description"] for change in response.json()["changes"]] == ["cello"]


async def test_does_not_follow_a_change_that_removed_two_notes(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # Two notes gone and one new is no move: which one it came from is a guess.
    (versioned_vault / "a.md").write_text("# a\n")
    (versioned_vault / "b.md").write_text("# b\n")
    jj(versioned_vault, "commit", "-m", "two notes")
    (versioned_vault / "a.md").unlink()
    (versioned_vault / "b.md").unlink()
    (versioned_vault / "c.md").write_text("# c\n")
    jj(versioned_vault, "commit", "-m", "merged")

    response = await client.get("/api/history", params={"path": "c.md"})

    assert [change["description"] for change in response.json()["changes"]] == ["merged"]


async def test_reads_the_text_of_the_note_at_a_change(
    client: AsyncClient, versioned_vault: Path
) -> None:
    await client.post("/api/files/index.md")
    await client.put("/api/files/index.md", json={"content": "# first\n"})
    await client.post("/api/files/other.md")
    await client.put("/api/files/index.md", json={"content": "# second\n"})
    changes = (await client.get("/api/history", params={"path": "index.md"})).json()["changes"]

    response = await client.get(
        "/api/history/version", params={"path": "index.md", "commit": changes[1]["commit"]}
    )

    assert response.status_code == 200
    assert response.json() == {"content": "# first\n"}


async def test_seals_a_restore_in_a_change_of_its_own(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # Saved as a plain save, the restore would amend the change holding T1 and
    # the text it replaced would be in no change at all.
    await client.post("/api/files/index.md")
    await client.put("/api/files/index.md", json={"content": "# T0\n"})
    await client.post("/api/files/other.md")
    await client.put("/api/files/index.md", json={"content": "# T1\n"})
    t0 = (await client.get("/api/history", params={"path": "index.md"})).json()["changes"][1]

    await client.put(
        "/api/files/index.md", json={"content": "# T0\n", "restored_from": t0["change"]}
    )

    changes = (await client.get("/api/history", params={"path": "index.md"})).json()["changes"]
    assert changes[0]["description"] == f"vault: index.md (restored from {t0['change']})"
    texts = [
        (
            await client.get(
                "/api/history/version", params={"path": "index.md", "commit": change["commit"]}
            )
        ).json()["content"]
        for change in changes[1:]
    ]
    assert any(text.endswith("# T1\n") for text in texts)


async def test_refuses_a_restored_from_that_is_not_a_change_id(
    client: AsyncClient, versioned_vault: Path
) -> None:
    await client.post("/api/files/index.md")

    response = await client.put(
        "/api/files/index.md", json={"content": "# T0\n", "restored_from": "abc) | all()"}
    )

    assert response.status_code == 422


async def test_writes_no_operation_to_the_repo(client: AsyncClient, versioned_vault: Path) -> None:
    # A plain `jj log` snapshots and records an operation. The read path must not,
    # and an edit made outside kasten must stay unrecorded too.
    await client.post("/api/files/index.md")
    (versioned_vault / "index.md").write_text("# edited outside\n")
    before = op_count(versioned_vault)

    listed = await client.get("/api/history", params={"path": "index.md"})
    version = await client.get(
        "/api/history/version",
        params={"path": "index.md", "commit": listed.json()["changes"][0]["commit"]},
    )

    assert version.status_code == 200
    assert op_count(versioned_vault) == before


async def test_runs_every_jj_call_read_only_as_a_list(
    client: AsyncClient, versioned_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    await client.post("/api/files/index.md")
    commit = commit_of(versioned_vault, "@")
    calls: list[tuple[str, ...]] = []
    spawn = asyncio.create_subprocess_exec

    # Pipes and nothing else, so a call that asked for anything more raises here.
    async def recording(*argv: str, stdout: int, stderr: int) -> asyncio.subprocess.Process:
        calls.append(argv)
        return await spawn(*argv, stdout=stdout, stderr=stderr)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", recording)

    await client.get("/api/history", params={"path": "index.md"})
    await client.get("/api/history/version", params={"path": "index.md", "commit": commit})

    assert len(calls) == 4
    for argv in calls:
        assert argv[:2] == ("jj", "--ignore-working-copy")
        assert argv[4] in {"log", "file"}
        assert all(isinstance(arg, str) for arg in argv)


async def test_kills_a_jj_that_runs_too_long(
    client: AsyncClient, versioned_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    spawned: list[asyncio.subprocess.Process] = []
    spawn = asyncio.create_subprocess_exec

    async def hanging(*_argv: str, stdout: int, stderr: int) -> asyncio.subprocess.Process:
        process = await spawn("sleep", "30", stdout=stdout, stderr=stderr)
        spawned.append(process)
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", hanging)
    monkeypatch.setattr(history, "TIMEOUT", 0.1)

    response = await client.get("/api/history", params={"path": "index.md"})

    assert response.status_code == 503
    assert response.json()["detail"]
    assert spawned[0].returncode is not None


async def test_answers_503_when_jj_writes_bytes_that_are_not_utf8(
    client: AsyncClient, versioned_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    spawn = asyncio.create_subprocess_exec

    async def garbled(*_argv: str, stdout: int, stderr: int) -> asyncio.subprocess.Process:
        # `printf` turns the octal escape into the one byte 0xff, never UTF-8.
        return await spawn("printf", "\\377", stdout=stdout, stderr=stderr)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", garbled)

    response = await client.get("/api/history", params={"path": "index.md"})

    assert response.status_code == 503


async def test_kills_jj_when_the_request_is_cancelled(
    versioned_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    spawned: list[asyncio.subprocess.Process] = []
    started = asyncio.Event()
    spawn = asyncio.create_subprocess_exec

    async def hanging(*_argv: str, stdout: int, stderr: int) -> asyncio.subprocess.Process:
        process = await spawn("sleep", "30", stdout=stdout, stderr=stderr)
        spawned.append(process)
        started.set()
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", hanging)
    reading = asyncio.create_task(history.list_changes(versioned_vault, "index.md"))
    await started.wait()

    reading.cancel()
    with pytest.raises(asyncio.CancelledError):
        await reading

    returncode = spawned[0].returncode
    if returncode is None:
        # Reaped here so a failing run leaves no child behind either.
        spawned[0].kill()
        await spawned[0].wait()
    assert returncode is not None


@pytest.mark.parametrize(
    "name",
    [
        'say "hi".md',
        "back\\slash.md",
        "*.md",
        "a|b.md",
        "~x.md",
        "(paren).md",
        "-lead.md",
        "a b.md",
    ],
)
async def test_lists_only_the_note_a_crafted_name_names(
    client: AsyncClient, versioned_vault: Path, name: str
) -> None:
    # Two other notes, so a name read as a glob, a prefix or an operator would
    # catch one of them.
    for other in ("plain.md", "a.md"):
        (versioned_vault / other).write_text(f"# {other}\n")
        jj(versioned_vault, "commit", "-m", other)
    (versioned_vault / name).write_text("# crafted\n")
    jj(versioned_vault, "commit", "-m", "crafted")

    response = await client.get("/api/history", params={"path": name})

    assert response.status_code == 200
    changes = response.json()["changes"]
    assert [change["description"] for change in changes] == ["crafted"]
    version = await client.get(
        "/api/history/version", params={"path": name, "commit": changes[0]["commit"]}
    )
    assert version.json() == {"content": "# crafted\n"}


async def test_answers_unversioned_for_a_vault_that_is_not_a_repo(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "index.md").write_text("# index\n")

    response = await client.get("/api/history", params={"path": "index.md"})

    assert response.status_code == 200
    assert response.json() == {"versioned": False, "changes": []}


async def test_answers_unversioned_when_there_is_no_jj(
    client: AsyncClient, versioned_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PATH", "")

    response = await client.get("/api/history", params={"path": "index.md"})

    assert response.status_code == 200
    assert response.json() == {"versioned": False, "changes": []}


async def test_answers_503_when_jj_fails(client: AsyncClient, vault: Path) -> None:
    # A directory that looks like a repo and is not, so every jj command fails.
    (vault / ".jj").mkdir()

    response = await client.get("/api/history", params={"path": "index.md"})

    assert response.status_code == 503
    assert response.json()["detail"]


async def test_lists_nothing_for_a_note_with_no_history(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # On disk and never snapshotted, which the read path must not do for it.
    (versioned_vault / "index.md").write_text("# index\n")

    response = await client.get("/api/history", params={"path": "index.md"})

    assert response.status_code == 200
    assert response.json() == {"versioned": True, "changes": []}


@pytest.mark.parametrize("commit", ["abc", "A" * 40, "0" * 39 + "g", "@", "0" * 41])
async def test_refuses_a_commit_that_is_not_40_hex_digits(
    client: AsyncClient, versioned_vault: Path, commit: str
) -> None:
    response = await client.get(
        "/api/history/version", params={"path": "index.md", "commit": commit}
    )

    assert response.status_code == 422


async def test_answers_404_for_a_commit_or_a_path_jj_does_not_have(
    client: AsyncClient, versioned_vault: Path
) -> None:
    await client.post("/api/files/index.md")
    commit = commit_of(versioned_vault, "@")

    # The note at its own commit answers, so the 404s below are about the input.
    known = await client.get("/api/history/version", params={"path": "index.md", "commit": commit})
    unknown = await client.get(
        "/api/history/version", params={"path": "index.md", "commit": "0" * 39 + "1"}
    )
    elsewhere = await client.get(
        "/api/history/version", params={"path": "other.md", "commit": commit}
    )
    outside = await client.get(
        "/api/history/version", params={"path": "../index.md", "commit": commit}
    )

    assert known.status_code == 200
    assert unknown.status_code == 404
    assert elsewhere.status_code == 404
    assert outside.status_code == 404
