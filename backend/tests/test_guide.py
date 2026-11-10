from typing import TYPE_CHECKING

from asgi_lifespan import LifespanManager

from kasten_backend.guide import EXAM_GUIDE_PATH, GUIDE_PATH
from kasten_backend.main import app

if TYPE_CHECKING:
    from pathlib import Path

KEPT = "---\ntype: Reference\n---\nmine\n"
"""What a reader has edited a guide down to, in the shape a startup note has.

Typed rather than a bare `mine\n`, because the type backfill runs in the same
lifespan these tests run. An untyped note would be typed by that pass, and these
tests are about the startup write leaving a note the vault already holds alone.
"""


async def test_startup_writes_the_guide(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    note = startup_vault / GUIDE_PATH
    text = note.read_text(encoding="utf-8")

    assert text.startswith("---\n")
    assert "id: " in text
    assert "type: Reference" in text
    assert "# How to work with todos" in text


async def test_the_guide_names_the_review_state(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    text = (startup_vault / GUIDE_PATH).read_text(encoding="utf-8")

    assert "| `[r]` | review |" in text
    assert "[ /xXbwr-]" in text
    # An agent moving a ticked todo back to review leaves done, so the guide
    # has to send it through the un-ticking walk, done log line and all.
    assert "from `[x]` to `[r]`" in text
    assert "delete its done log line" in text


async def test_startup_keeps_the_guide_the_vault_already_has(startup_vault: Path) -> None:
    note = startup_vault / GUIDE_PATH
    note.parent.mkdir(parents=True)
    note.write_text(KEPT, encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert note.read_text(encoding="utf-8") == KEPT


async def test_startup_writes_the_exam_guide(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    note = startup_vault / EXAM_GUIDE_PATH
    text = note.read_text(encoding="utf-8")

    assert text.startswith("---\n")
    assert "id: " in text
    assert "type: Reference" in text
    assert "# How to write a practice exam" in text


async def test_startup_keeps_the_exam_guide_the_vault_already_has(startup_vault: Path) -> None:
    note = startup_vault / EXAM_GUIDE_PATH
    note.parent.mkdir(parents=True)
    note.write_text(KEPT, encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert note.read_text(encoding="utf-8") == KEPT


async def test_one_guide_kept_does_not_stop_the_other_arriving(startup_vault: Path) -> None:
    """Each is written on its own, so a vault holding one still gets the other."""
    kept = startup_vault / GUIDE_PATH
    kept.parent.mkdir(parents=True)
    kept.write_text(KEPT, encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert kept.read_text(encoding="utf-8") == KEPT
    assert (startup_vault / EXAM_GUIDE_PATH).exists()


async def test_startup_writes_the_meal_planner_skill_raw(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    text = (startup_vault / ".claude/skills/meal-planner/SKILL.md").read_text(encoding="utf-8")

    assert text.startswith("---\nname: meal-planner\n")
    assert "\nid: " not in text
    assert "`05 Shared/Woche <NN>.md`" in text
    assert "{{" not in text


async def test_startup_keeps_a_meal_planner_the_vault_already_has(startup_vault: Path) -> None:
    skill = startup_vault / ".claude/skills/meal-planner/SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("mine\n", encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert skill.read_text(encoding="utf-8") == "mine\n"


async def test_startup_writes_no_skill_through_a_linked_skills_folder(
    startup_vault: Path, tmp_path: Path
) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (startup_vault / ".claude").mkdir(parents=True)
    (startup_vault / ".claude/skills").symlink_to(outside)

    async with LifespanManager(app):
        pass

    assert list(outside.iterdir()) == []


async def test_startup_starts_past_a_dangling_link_or_a_file_for_the_skills_folder(
    startup_vault: Path, tmp_path: Path
) -> None:
    (startup_vault / ".claude").mkdir(parents=True)
    (startup_vault / ".claude/skills").symlink_to(tmp_path / "nowhere")

    async with LifespanManager(app):
        pass

    (startup_vault / ".claude/skills").unlink()
    (startup_vault / ".claude/skills").write_text("not a folder\n", encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert not (tmp_path / "nowhere").exists()
