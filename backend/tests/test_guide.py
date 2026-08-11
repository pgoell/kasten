from typing import TYPE_CHECKING

from asgi_lifespan import LifespanManager

from kasten_backend.guide import EXAM_GUIDE_PATH, GUIDE_PATH
from kasten_backend.main import app

if TYPE_CHECKING:
    from pathlib import Path


async def test_startup_writes_the_guide(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    note = startup_vault / GUIDE_PATH
    text = note.read_text(encoding="utf-8")

    assert text.startswith("---\n")
    assert "id: " in text
    assert "# How to work with todos" in text


async def test_startup_keeps_the_guide_the_vault_already_has(startup_vault: Path) -> None:
    note = startup_vault / GUIDE_PATH
    note.parent.mkdir(parents=True)
    note.write_text("mine\n", encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert note.read_text(encoding="utf-8") == "mine\n"


async def test_startup_writes_the_exam_guide(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    note = startup_vault / EXAM_GUIDE_PATH
    text = note.read_text(encoding="utf-8")

    assert text.startswith("---\n")
    assert "id: " in text
    assert "# How to write a practice exam" in text


async def test_startup_keeps_the_exam_guide_the_vault_already_has(startup_vault: Path) -> None:
    note = startup_vault / EXAM_GUIDE_PATH
    note.parent.mkdir(parents=True)
    note.write_text("mine\n", encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert note.read_text(encoding="utf-8") == "mine\n"


async def test_one_guide_kept_does_not_stop_the_other_arriving(startup_vault: Path) -> None:
    """Each is written on its own, so a vault holding one still gets the other."""
    kept = startup_vault / GUIDE_PATH
    kept.parent.mkdir(parents=True)
    kept.write_text("mine\n", encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert kept.read_text(encoding="utf-8") == "mine\n"
    assert (startup_vault / EXAM_GUIDE_PATH).exists()
