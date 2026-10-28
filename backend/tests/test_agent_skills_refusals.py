"""What the skills folder refuses: every path out of it, every file it will not read, every write.

A refusal reads as absent on the REST routes, a 404 with the detail "No such
skill file", and as a tool error on MCP. It is never a 500, and never the
secret in the settings file beside the skills.
"""

from typing import TYPE_CHECKING

from backend.tests.test_agent_skills import API_KEY, build_layout, skill_md
from backend.tests.test_mcp import ENDPOINT, RPC, call, payload
from kasten_backend import skills

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def refused_over_rest(client: AsyncClient, bearer: dict[str, str], path: str) -> None:
    """A REST read that answers as absent, with the one detail the refusal carries."""
    response = await client.get(f"/agent/skills/{path}", headers=bearer)

    assert response.status_code == 404
    assert response.json() == {"detail": "No such skill file"}


async def refused_over_mcp(client: AsyncClient, bearer: dict[str, str], path: str) -> None:
    """An MCP read that answers with a tool error."""
    response = await client.post(
        ENDPOINT, json=call("read_skill", {"path": path}), headers={**bearer, **RPC}
    )

    assert payload(response.text)["result"]["isError"] is True
    assert API_KEY not in response.text


def listed_files(listing: list[dict], name: str) -> list[str]:
    """The files one skill lists, or none when it is not listed."""
    return next((skill["files"] for skill in listing if skill["name"] == name), [])


async def test_read_skill_refuses_a_path_out_of_the_skills_folder(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)
    (agent_vault / "settings.json").write_text(API_KEY)

    for path in ("..%2F..%2Fsettings.json", "..%2Fsettings.json"):
        await refused_over_rest(client, bearer, path)
    for path in ("../settings.json", "../../.claude/settings.json"):
        await refused_over_mcp(client, bearer, path)


async def test_read_skill_refuses_an_absolute_path(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)

    await refused_over_mcp(client, bearer, str(agent_vault / ".claude/settings.json"))
    await refused_over_mcp(client, bearer, "/etc/passwd")
    await refused_over_rest(client, bearer, "%2Fetc%2Fpasswd")


async def test_read_skill_refuses_the_rest_of_dot_claude(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)
    (agent_vault / ".claude" / "settings.local.json").write_text(API_KEY)

    for path in ("../settings.json", "../settings.local.json", "../../.claude/settings.json"):
        await refused_over_mcp(client, bearer, path)
    await refused_over_rest(client, bearer, "..%2Fsettings.local.json")


async def test_read_skill_refuses_a_hidden_file_inside_a_skill(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    skills_folder = build_layout(agent_vault)
    (skills_folder / "close-day" / ".env").write_text(API_KEY)

    listing = await client.get("/agent/skills", headers=bearer)

    assert listed_files(listing.json(), "close-day") == ["close-day/SKILL.md"]
    await refused_over_rest(client, bearer, "close-day/.env")
    await refused_over_mcp(client, bearer, "close-day/.env")


async def test_read_skill_refuses_a_suffix_it_does_not_read(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    skills_folder = build_layout(agent_vault)
    (skills_folder / "close-day" / "logo.png").write_bytes(b"\x89PNG " + API_KEY.encode())
    (skills_folder / "close-day" / "Makefile").write_text(API_KEY)

    listing = await client.get("/agent/skills", headers=bearer)

    assert listed_files(listing.json(), "close-day") == ["close-day/SKILL.md"]
    await refused_over_rest(client, bearer, "close-day/logo.png")
    await refused_over_rest(client, bearer, "close-day/Makefile")


async def test_read_skill_refuses_a_binary_file(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    skills_folder = build_layout(agent_vault)
    (skills_folder / "close-day" / "data.md").write_bytes(b"\xff\xfe\x00bin")
    (skills_folder / "close-day" / "nul.txt").write_bytes(b"a\x00b")

    listing = await client.get("/agent/skills", headers=bearer)

    assert listed_files(listing.json(), "close-day") == ["close-day/SKILL.md"]
    await refused_over_rest(client, bearer, "close-day/data.md")
    await refused_over_rest(client, bearer, "close-day/nul.txt")


async def test_read_skill_refuses_a_file_over_the_cap(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    skills_folder = build_layout(agent_vault)
    (skills_folder / "close-day" / "big.md").write_bytes(b"a" * (skills.MOST_BYTES + 1))

    listing = await client.get("/agent/skills", headers=bearer)

    assert listed_files(listing.json(), "close-day") == ["close-day/SKILL.md"]
    await refused_over_rest(client, bearer, "close-day/big.md")


async def test_read_skill_refuses_a_folder(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)

    await refused_over_rest(client, bearer, "close-day")
    await refused_over_mcp(client, bearer, "close-day")


async def test_read_skill_refuses_a_null_byte(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)

    await refused_over_mcp(client, bearer, "close-day/SKILL.md\x00")
    await refused_over_rest(client, bearer, "close-day/SKILL.md%00")


async def test_read_skill_refuses_an_overlong_name(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)
    name = f"{'a' * 300}.md"

    await refused_over_rest(client, bearer, f"close-day/{name}")
    await refused_over_mcp(client, bearer, f"close-day/{name}")


async def test_a_file_linked_out_of_the_skills_folder_is_refused_and_unlisted(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], tmp_path: Path
) -> None:
    skills_folder = build_layout(agent_vault)
    (agent_vault / "secret.md").write_text("SECRET\n")
    outside = tmp_path / "outside.md"
    outside.write_text("SECRET\n")
    (skills_folder / "close-day" / "notes.md").symlink_to(agent_vault / "secret.md")
    (skills_folder / "close-day" / "out.md").symlink_to(outside)

    listing = await client.get("/agent/skills", headers=bearer)

    assert listed_files(listing.json(), "close-day") == ["close-day/SKILL.md"]
    await refused_over_rest(client, bearer, "close-day/notes.md")
    await refused_over_rest(client, bearer, "close-day/out.md")
    assert "SECRET" not in listing.text


async def test_a_folder_linked_out_of_the_skills_folder_is_refused_and_unlisted(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], tmp_path: Path
) -> None:
    skills_folder = build_layout(agent_vault)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "SKILL.md").write_text(skill_md("evil", "Outside the vault."))
    projects = agent_vault / "projects"
    projects.mkdir()
    (projects / "SKILL.md").write_text(skill_md("vaultlink", "Inside the vault."))
    (skills_folder / "evil").symlink_to(elsewhere)
    (skills_folder / "vaultlink").symlink_to(projects)

    listing = await client.get("/agent/skills", headers=bearer)

    names = [skill["name"] for skill in listing.json()]
    assert "evil" not in names
    assert "vaultlink" not in names
    await refused_over_rest(client, bearer, "evil/SKILL.md")
    await refused_over_rest(client, bearer, "vaultlink/SKILL.md")
    assert "Outside the vault." not in listing.text


async def test_a_skills_folder_linked_out_of_the_vault_is_empty(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], tmp_path: Path
) -> None:
    outside = tmp_path / "outside-claude"
    (outside / "skills" / "x").mkdir(parents=True)
    (outside / "skills" / "x" / "SKILL.md").write_text(skill_md("x", "Outside."))
    (agent_vault / ".claude").symlink_to(outside)

    listing = await client.get("/agent/skills", headers=bearer)

    assert listing.status_code == 200
    assert listing.json() == []
    await refused_over_rest(client, bearer, "x/SKILL.md")
    await refused_over_mcp(client, bearer, "x/SKILL.md")


async def test_no_skills_folder_lists_none(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    listing = await client.get("/agent/skills", headers=bearer)
    mcp = await client.post(ENDPOINT, json=call("list_skills", {}), headers={**bearer, **RPC})

    assert listing.json() == []
    assert payload(mcp.text)["result"]["structuredContent"]["result"] == []
    await refused_over_rest(client, bearer, "close-day/SKILL.md")


async def test_no_write_reaches_the_skills_folder(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)
    target = agent_vault / ".claude" / "skills" / "close-day" / "SKILL.md"
    before = target.read_bytes()

    save = await client.post(
        ENDPOINT,
        json=call(
            "save_note",
            {"path": ".claude/skills/close-day/SKILL.md", "content": "rm -rf /", "sha": None},
        ),
        headers={**bearer, **RPC},
    )
    append = await client.post(
        ENDPOINT,
        json=call(
            "append_note", {"path": ".claude/skills/close-day/SKILL.md", "text": "\nrm -rf /\n"}
        ),
        headers={**bearer, **RPC},
    )
    put = await client.put(
        "/agent/notes/.claude/skills/close-day/SKILL.md",
        json={"content": "rm -rf /"},
        headers=bearer,
    )

    assert payload(save.text)["result"]["isError"] is True
    assert payload(append.text)["result"]["isError"] is True
    assert put.status_code == 404
    assert target.read_bytes() == before


async def test_read_note_still_answers_no_such_note_for_a_skill(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)

    rest = await client.get("/agent/notes/.claude/skills/close-day/SKILL.md", headers=bearer)
    mcp = await client.post(
        ENDPOINT,
        json=call("read_note", {"path": ".claude/skills/close-day/SKILL.md"}),
        headers={**bearer, **RPC},
    )

    assert rest.status_code == 404
    assert rest.json() == {"detail": "No such note"}
    assert payload(mcp.text)["result"]["isError"] is True
    assert "No such note" in mcp.text
    assert API_KEY not in rest.text + mcp.text


async def test_a_skills_folder_linked_to_a_hidden_vault_folder_is_empty(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # Inside the vault and still refused: a link to `.jj` would hand out the
    # jj repo, which the dotfile rule keeps from every other read.
    jj = agent_vault / ".jj"
    (jj / "x").mkdir(parents=True)
    (jj / "x" / "SKILL.md").write_text(skill_md("x", API_KEY))
    (agent_vault / ".claude").mkdir()
    (agent_vault / ".claude" / "skills").symlink_to(jj)

    listing = await client.get("/agent/skills", headers=bearer)

    assert listing.status_code == 200
    assert listing.json() == []
    await refused_over_rest(client, bearer, "x/SKILL.md")
    await refused_over_mcp(client, bearer, "x/SKILL.md")


async def test_an_unreadable_skill_file_is_absent_and_the_rest_still_lists(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    skills_folder = build_layout(agent_vault)
    locked = skills_folder / "close-day" / "locked.md"
    locked.write_text(API_KEY)
    locked.chmod(0)

    listing = await client.get("/agent/skills", headers=bearer)

    assert listing.status_code == 200
    assert "close-day/locked.md" not in listed_files(listing.json(), "close-day")
    assert "close-day/SKILL.md" in listed_files(listing.json(), "close-day")
    await refused_over_rest(client, bearer, "close-day/locked.md")
    await refused_over_mcp(client, bearer, "close-day/locked.md")


async def test_a_hidden_link_to_a_skill_file_lists_by_the_file_it_reads(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    skills_folder = build_layout(agent_vault)
    (skills_folder / "close-day" / ".hid.md").symlink_to(skills_folder / "close-day" / "SKILL.md")

    listing = await client.get("/agent/skills", headers=bearer)

    # A read through the link answers with the file it lands on, which the
    # listing already names, so the hidden name is never handed out.
    assert listed_files(listing.json(), "close-day") == ["close-day/SKILL.md"]
