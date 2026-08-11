from typing import TYPE_CHECKING

from asgi_lifespan import LifespanManager

from kasten_backend.main import app

if TYPE_CHECKING:
    from pathlib import Path

    import pytest


def _ignores(root: Path) -> list[str]:
    return (root / ".gitignore").read_text(encoding="utf-8").splitlines()


async def test_startup_writes_both_lines(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    assert _ignores(startup_vault) == ["*.epub", ".*.tmp"]


async def test_startup_keeps_the_lines_the_vault_already_had(startup_vault: Path) -> None:
    ignores = startup_vault / ".gitignore"
    ignores.parent.mkdir(parents=True)
    ignores.write_text("*.pdf\n", encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert _ignores(startup_vault) == ["*.pdf", "*.epub", ".*.tmp"]


async def test_startup_adds_only_the_missing_line(startup_vault: Path) -> None:
    ignores = startup_vault / ".gitignore"
    ignores.parent.mkdir(parents=True)
    ignores.write_text("*.epub\n", encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert _ignores(startup_vault) == ["*.epub", ".*.tmp"]


async def test_starting_twice_is_not_an_edit(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass
    first = (startup_vault / ".gitignore").read_bytes()

    async with LifespanManager(app):
        pass

    assert (startup_vault / ".gitignore").read_bytes() == first


async def test_the_lines_are_there_before_the_guide_is_written(
    startup_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The order is the whole point: `write_guide` takes a jj snapshot, which must
    # not happen while an unignored book is sitting in the vault. Every other case
    # here reads the file after startup finished, so every one of them passes with
    # the two calls the wrong way round.
    seen: list[str] = []

    async def record(root: Path) -> None:
        ignores = root / ".gitignore"
        seen.append(ignores.read_text(encoding="utf-8") if ignores.is_file() else "")

    # Patched on `main`, which is the name `lifespan` calls. Patching
    # `kasten_backend.guide.write_guide` would leave `lifespan` calling the real
    # one and this list empty.
    monkeypatch.setattr("kasten_backend.main.write_guide", record)

    async with LifespanManager(app):
        pass

    assert seen == ["*.epub\n.*.tmp\n"]
