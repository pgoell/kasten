"""The `project` `GET /api/todos` gives each todo, and the `#p/x` tag that overrides it.

The `a2_port` tests are the board's old `folderProject` and `projectOf` cases,
one for one, which is what proves a todo with no tag lands in the lane it did
when the rule lived in the frontend.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

PATHS = [
    "02 Projects/FDE/index.md",
    "02 Projects/FDE/notes/2026/kickoff.md",
    "02 Projects/Atlas/index.md",
    "02 Projects/Loose/plan.md",
    "02 Projects/readme.md",
    "03 Areas/08 People/Louise.md",
    "01 Periodic/2026-10-16.md",
]
"""The board tests' vault: two projects, one folder without an index, and a person."""

DAILY = "01 Periodic/2026-10-16.md"


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


def projects_vault(vault: Path) -> None:
    """Every note of `PATHS`, empty, so a link to one lands."""
    for path in PATHS:
        write(vault, path, "")


async def projects(client: AsyncClient, *, archive: bool = False) -> dict[str, str | None]:
    """Each todo line's project, keyed by its text."""
    response = await client.get("/api/todos", params={"archive": archive})
    assert response.status_code == 200
    return {hit["text"]: hit["project"] for hit in response.json()}


async def test_a2_port_folder_three_folders_deep(client: AsyncClient, vault: Path) -> None:
    write(vault, "02 Projects/FDE/notes/2026/kickoff.md", "- [ ] a\n")

    assert (await projects(client))["- [ ] a"] == "02 Projects/FDE"


async def test_a2_port_folder_under_areas_is_a_project(client: AsyncClient, vault: Path) -> None:
    write(vault, "03 Areas/06 Allianz Direct/plan.md", "- [ ] a\n")

    assert (await projects(client))["- [ ] a"] == "03 Areas/06 Allianz Direct"


async def test_a2_port_note_at_vault_root_has_none(client: AsyncClient, vault: Path) -> None:
    write(vault, "todo.md", "- [ ] a\n")

    assert (await projects(client))["- [ ] a"] is None


async def test_a2_port_note_directly_in_a_root_has_none(client: AsyncClient, vault: Path) -> None:
    write(vault, "02 Projects/readme.md", "- [ ] a\n")

    assert (await projects(client))["- [ ] a"] is None


async def test_a2_port_note_outside_the_roots_has_none(client: AsyncClient, vault: Path) -> None:
    write(vault, "04 Ressources/03 Workshops/a.md", "- [ ] a\n")

    assert (await projects(client))["- [ ] a"] is None


async def test_a2_port_folder_over_any_link(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, "02 Projects/FDE/index.md", "- [ ] send [[02 Projects/Atlas/index|Atlas]]\n")

    found = await projects(client)

    assert found["- [ ] send [[02 Projects/Atlas/index|Atlas]]"] == "02 Projects/FDE"


async def test_a2_port_daily_todo_filed_by_its_link(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [ ] send the deck [[02 Projects/FDE/index|FDE]]\n")

    found = await projects(client)

    assert found["- [ ] send the deck [[02 Projects/FDE/index|FDE]]"] == "02 Projects/FDE"


async def test_a2_port_link_with_heading_and_alias(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [ ] send the deck [[02 Projects/FDE/index#x|FDE]]\n")

    found = await projects(client)

    assert found["- [ ] send the deck [[02 Projects/FDE/index#x|FDE]]"] == "02 Projects/FDE"


async def test_a2_port_no_project_from_a_person(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [ ] ask [[Louise]]\n")

    assert (await projects(client))["- [ ] ask [[Louise]]"] is None


async def test_a2_port_skips_a_link_to_a_missing_note(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    line = "- [ ] ask [[02 Projects/Ghost/index]] then [[02 Projects/Atlas/index]]"
    write(vault, DAILY, f"{line}\n")

    assert (await projects(client))[line] == "02 Projects/Atlas"


async def test_a2_port_falls_back_to_the_parent(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [ ] send [[02 Projects/FDE/index]]\n  - [ ] a part\n")

    assert (await projects(client))["  - [ ] a part"] == "02 Projects/FDE"


async def test_a1_every_hit_carries_a_project(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, "02 Projects/Loose/plan.md", "- [ ] by folder\n")
    write(
        vault,
        DAILY,
        "- [ ] by link [[02 Projects/Atlas/index]]\n  - [ ] by parent\n- [ ] by nothing\n",
    )

    response = await client.get("/api/todos")

    assert sorted((hit["text"], hit["project"]) for hit in response.json()) == [
        ("  - [ ] by parent", "02 Projects/Atlas"),
        ("- [ ] by folder", "02 Projects/Loose"),
        ("- [ ] by link [[02 Projects/Atlas/index]]", "02 Projects/Atlas"),
        ("- [ ] by nothing", None),
    ]


async def test_i1_tag_beats_the_folder(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, "02 Projects/FDE/index.md", "- [ ] a #p/atlas\n")

    assert (await projects(client))["- [ ] a #p/atlas"] == "02 Projects/Atlas"


async def test_i1_tag_beats_a_link(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    line = "- [ ] a [[02 Projects/FDE/index]] #p/atlas"
    write(vault, DAILY, f"{line}\n")

    assert (await projects(client))[line] == "02 Projects/Atlas"


async def test_i2_unknown_tag_is_passed_over(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, "02 Projects/FDE/index.md", "- [ ] a #p/ghost\n")
    write(vault, DAILY, "- [ ] b #p/ghost\n- [ ] c #p/\n")

    found = await projects(client)

    assert found["- [ ] a #p/ghost"] == "02 Projects/FDE"
    assert found["- [ ] b #p/ghost"] is None
    assert found["- [ ] c #p/"] is None


async def test_i3_case_and_punctuation(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [ ] a #P/FDE\n- [ ] b ends #p/fde.\n- [ ] c #p/fde, then\n")

    found = await projects(client)

    assert found["- [ ] a #P/FDE"] == "02 Projects/FDE"
    assert found["- [ ] b ends #p/fde."] == "02 Projects/FDE"
    assert found["- [ ] c #p/fde, then"] == "02 Projects/FDE"


async def test_i3_hyphen_and_underscore_stand_for_a_space(client: AsyncClient, vault: Path) -> None:
    write(vault, "02 Projects/Japan Honeymoon 2027/index.md", "")
    write(vault, DAILY, "- [ ] a #p/japan-honeymoon-2027\n- [ ] b #p/Japan_Honeymoon_2027\n")

    found = await projects(client)

    assert found["- [ ] a #p/japan-honeymoon-2027"] == "02 Projects/Japan Honeymoon 2027"
    assert found["- [ ] b #p/Japan_Honeymoon_2027"] == "02 Projects/Japan Honeymoon 2027"


async def test_i4_nested_tag_names_its_first_segment(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [ ] a #p/fde/workshops\n")

    assert (await projects(client))["- [ ] a #p/fde/workshops"] == "02 Projects/FDE"


async def test_i5_first_tag_that_names_a_folder_wins(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [ ] a #p/atlas #p/fde\n- [ ] b #p/ghost #p/fde #p/atlas\n")

    found = await projects(client)

    assert found["- [ ] a #p/atlas #p/fde"] == "02 Projects/Atlas"
    assert found["- [ ] b #p/ghost #p/fde #p/atlas"] == "02 Projects/FDE"


async def test_i6_part_takes_its_ancestors_tag_over_its_folder(
    client: AsyncClient, vault: Path
) -> None:
    projects_vault(vault)
    write(
        vault,
        "02 Projects/FDE/index.md",
        "- [ ] top #p/atlas\n  - [ ] middle\n    - [ ] part\n\tprose\n\t- [ ] tabbed\n",
    )

    found = await projects(client)

    assert found["  - [ ] middle"] == "02 Projects/Atlas"
    assert found["    - [ ] part"] == "02 Projects/Atlas"
    assert found["\t- [ ] tabbed"] == "02 Projects/Atlas"


async def test_i6_part_with_its_own_tag_keeps_it(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [ ] top #p/atlas\n  - [ ] part #p/fde\n- [ ] sibling\n")

    found = await projects(client)

    assert found["  - [ ] part #p/fde"] == "02 Projects/FDE"
    assert found["- [ ] sibling"] is None


async def test_i7_tagged_todo_in_a_daily_note(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [ ] a #p/loose\n")

    assert (await projects(client))["- [ ] a #p/loose"] == "02 Projects/Loose"


async def test_i7_done_and_rejected_todos(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, DAILY, "- [x] a #p/fde ✅ 2026-10-16\n- [-] b #p/atlas ❌ 2026-10-16\n")

    found = await projects(client)

    assert found["- [x] a #p/fde ✅ 2026-10-16"] == "02 Projects/FDE"
    assert found["- [-] b #p/atlas ❌ 2026-10-16"] == "02 Projects/Atlas"


async def test_i7_archived_todo(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, "98 Archive/old.md", "- [ ] a #p/fde\n")

    found = await projects(client, archive=True)

    assert found["- [ ] a #p/fde"] == "02 Projects/FDE"
    # The archive being off by default is what makes this a test of the flag.
    assert "- [ ] a #p/fde" not in await projects(client)


async def test_i7_session_line_has_none(client: AsyncClient, vault: Path) -> None:
    projects_vault(vault)
    write(vault, "02 Projects/FDE/index.md", "- [ ] a #p/atlas\n  - 14:03- a session\n")

    found = await projects(client)

    assert found["  - 14:03- a session"] is None
    assert found["- [ ] a #p/atlas"] == "02 Projects/Atlas"


async def test_b1_link_in_a_field_files_nothing(client: AsyncClient, vault: Path) -> None:
    write(vault, "02 Projects/FDE/People/Vendor.md", "")
    lines = [
        "- [w] chase quote 👤 2026-10-01 [[Vendor]]",
        "- [ ] water plants 🔁 every week [[Vendor]]",
        # The due date is taken first, so the rule runs on to the end of the line.
        "- [ ] pay rent 🔁 every month 📅 2026-10-01 [[Vendor]]",
        "- [ ] call [[Vendor]] 👤 Bob",
    ]
    write(vault, DAILY, "\n".join(lines) + "\n")

    found = await projects(client)

    assert found[lines[0]] is None
    assert found[lines[1]] is None
    assert found[lines[2]] is None
    assert found[lines[3]] == "02 Projects/FDE"


async def test_b2_line_the_editor_rejects_is_no_parent(client: AsyncClient, vault: Path) -> None:
    write(vault, "02 Projects/FDE/FDE Kickoff.md", "")
    # The editor's `.` stops at U+2028, so it reads no todo on this line.
    line = "- [ ] plan [[FDE Kickoff]]\N{LINE SEPARATOR}more"
    write(vault, DAILY, f"{line}\n  - [ ] book room\n")

    found = await projects(client)

    assert found[line] is None
    assert found["  - [ ] book room"] is None
