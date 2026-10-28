"""The skills folder as a token holder reads it: what is listed, and what a read returns.

The refusals live in test_agent_skills_refusals.py. The skills are laid out the
way Claude Code keeps them, in the vault's own `.claude` folder, beside a
settings file holding a secret that no skill route may ever hand back.
"""

import json
from typing import TYPE_CHECKING

from backend.tests.test_mcp import ENDPOINT, RPC, call, payload
from kasten_backend import skills
from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from httpx import AsyncClient

API_KEY = "sk-live-SECRET-9c1e"
"""A value the settings file holds, which no skill route may ever return."""

DESCRIPTIONS = {
    "close-day": "Close out the day in the daily note.",
    "process-meeting": "Turn a meeting transcript into linked notes.",
    "triage-inbox": "Sort the inbox into the right folders.",
}
"""The three skills the layout holds, each with the description its SKILL.md gives."""

SCRIPT = "#!/bin/sh\necho triage\n"
"""What `triage-inbox/kasten.sh` says, the one file that is not a SKILL.md."""


def skill_md(name: str, description: str) -> str:
    """A SKILL.md with the frontmatter Claude Code reads."""
    return f"---\nname: {name}\ndescription: {description}\n---\n"


def build_layout(vault: Path) -> Path:
    """The skills folder beside a settings file, and the path of the folder."""
    claude = vault / ".claude"
    skills_folder = claude / "skills"
    skills_folder.mkdir(parents=True)
    (claude / "settings.json").write_text(json.dumps({"env": {"API_KEY": API_KEY}}))
    for name, description in DESCRIPTIONS.items():
        (skills_folder / name).mkdir()
        (skills_folder / name / "SKILL.md").write_text(skill_md(name, description))
    (skills_folder / "triage-inbox" / "kasten.sh").write_text(SCRIPT)
    return skills_folder


async def test_list_skills_names_each_folder_with_a_skill_md(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)
    (agent_vault / "notes").mkdir()
    (agent_vault / "notes" / "readme.md").write_text("# notes\n")

    rest = await client.get("/agent/skills", headers=bearer)
    mcp = await client.post(ENDPOINT, json=call("list_skills", {}), headers={**bearer, **RPC})

    assert rest.status_code == 200
    assert sorted(skill["name"] for skill in rest.json()) == sorted(DESCRIPTIONS)
    triage = next(skill for skill in rest.json() if skill["name"] == "triage-inbox")
    assert sorted(triage["files"]) == ["triage-inbox/SKILL.md", "triage-inbox/kasten.sh"]

    listed = payload(mcp.text)["result"]["structuredContent"]["result"]
    assert sorted(skill["name"] for skill in listed) == sorted(DESCRIPTIONS)
    assert API_KEY not in rest.text
    assert API_KEY not in mcp.text


async def test_list_skills_reads_the_description_off_the_frontmatter(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)

    response = await client.get("/agent/skills", headers=bearer)

    assert response.status_code == 200
    assert {skill["name"]: skill["description"] for skill in response.json()} == DESCRIPTIONS


async def test_a_skill_md_without_a_description_lists_an_empty_one(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / ".claude" / "skills" / "bare").mkdir(parents=True)
    (agent_vault / ".claude" / "skills" / "bare" / "SKILL.md").write_text(
        "# Bare\n\nNo frontmatter.\n"
    )

    response = await client.get("/agent/skills", headers=bearer)

    assert response.status_code == 200
    assert response.json() == [{"name": "bare", "description": "", "files": ["bare/SKILL.md"]}]


async def test_read_skill_returns_the_file_text(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)

    rest_skill = await client.get("/agent/skills/close-day/SKILL.md", headers=bearer)
    rest_script = await client.get("/agent/skills/triage-inbox/kasten.sh", headers=bearer)
    mcp = await client.post(
        ENDPOINT,
        json=call("read_skill", {"path": "triage-inbox/kasten.sh"}),
        headers={**bearer, **RPC},
    )

    assert rest_skill.status_code == 200
    assert rest_skill.json() == {
        "path": "close-day/SKILL.md",
        "content": skill_md("close-day", DESCRIPTIONS["close-day"]),
    }
    assert rest_script.status_code == 200
    assert rest_script.json() == {"path": "triage-inbox/kasten.sh", "content": SCRIPT}
    assert payload(mcp.text)["result"]["structuredContent"] == {
        "path": "triage-inbox/kasten.sh",
        "content": SCRIPT,
    }
    assert API_KEY not in rest_skill.text


async def test_read_skill_reads_a_file_at_the_cap(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)
    (agent_vault / ".claude" / "skills" / "close-day" / "big.md").write_bytes(
        b"a" * skills.MOST_BYTES
    )

    listing = await client.get("/agent/skills", headers=bearer)
    response = await client.get("/agent/skills/close-day/big.md", headers=bearer)

    assert (
        "close-day/big.md" in next(s for s in listing.json() if s["name"] == "close-day")["files"]
    )
    assert response.status_code == 200
    assert len(response.json()["content"]) == skills.MOST_BYTES


async def test_list_notes_still_hides_the_skills(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)
    (agent_vault / "index.md").write_text("# index\n")

    rest = await client.get("/agent/notes", headers=bearer)
    mcp = await client.post(ENDPOINT, json=call("list_notes", {}), headers={**bearer, **RPC})

    assert rest.json() == ["index.md"]
    assert payload(mcp.text)["result"]["structuredContent"]["result"] == ["index.md"]


async def test_the_skills_routes_refuse_a_request_without_a_token(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    build_layout(agent_vault)
    # The same routes answer with the token, so the 401 below is the token
    # check and not a route that is missing.
    assert (await client.get("/agent/skills", headers=bearer)).status_code == 200
    stranger = {"Authorization": "Bearer not-a-token"}
    assert (await client.get("/agent/skills", headers=stranger)).status_code == 401

    listing = await client.get("/agent/skills")
    reading = await client.get("/agent/skills/close-day/SKILL.md")

    assert listing.status_code == 401
    assert reading.status_code == 401
    assert "close-day" not in listing.text + reading.text
    assert API_KEY not in listing.text + reading.text


async def test_the_skills_folder_is_a_setting(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    build_layout(agent_vault)
    monkeypatch.setenv("KASTEN_SKILLS_PATH", "agents/skills")
    get_settings.cache_clear()
    (agent_vault / "agents" / "skills" / "close-day").mkdir(parents=True)
    (agent_vault / "agents" / "skills" / "close-day" / "SKILL.md").write_text(
        skill_md("close-day", "Close out the day.")
    )

    response = await client.get("/agent/skills", headers=bearer)

    assert response.status_code == 200
    assert [skill["name"] for skill in response.json()] == ["close-day"]
    assert API_KEY not in response.text
