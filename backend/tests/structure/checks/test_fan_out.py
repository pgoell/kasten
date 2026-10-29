"""scripts/structure/check-fan-out with kasten's baseline and excludes."""

from typing import TYPE_CHECKING

from backend.tests.structure.repo import REPO, git, run, write

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

CHECK = "scripts/structure/check-fan-out"


def seven(folder: str) -> dict[str, int]:
    return {f"{folder}/f{i}.md": 10 for i in range(7)}


def test_the_repo_passes() -> None:
    result = run(REPO, CHECK, "--all")
    assert result.returncode == 0, result.stderr


def test_an_eighth_entry_in_a_folder_fails(make_repo: Callable[..., Path]) -> None:
    root = make_repo(seven("src"))
    assert run(root, CHECK, "--all").returncode == 0

    write(root, "src/f7.md", 10)
    result = run(root, CHECK, "--all")

    assert result.returncode == 1
    assert "fan-out: src holds 8 entries; the limit is 7." in result.stderr
    assert "Group by concept instead" in result.stderr


def test_growth_past_a_baseline_line_fails(make_repo: Callable[..., Path]) -> None:
    root = make_repo({**seven("src"), "src/f7.md": 10})
    (root / ".fan-out-baseline").write_text("src 8\n", encoding="utf-8")
    assert run(root, CHECK, "--all").returncode == 0

    write(root, "src/f8.md", 10)
    result = run(root, CHECK, "src/f8.md")

    assert result.returncode == 1
    assert "fan-out: src holds 9 entries; the limit is 7 and its baseline is 8." in result.stderr


def test_kastens_excludes_skip_the_dated_log_and_migrations(make_repo: Callable[..., Path]) -> None:
    files = {f"docs/log/2026/1{i}-01.md": 10 for i in range(9)}
    files |= {f"backend/alembic/versions/{i:04}_m.py": 10 for i in range(9)}
    root = make_repo(files, copy=(".fan-out-excludes",))

    result = run(root, CHECK, "--all")

    assert result.returncode == 0, result.stderr


def test_update_baseline_lowers_and_drops_but_never_raises_or_adds(
    make_repo: Callable[..., Path],
) -> None:
    root = make_repo(
        {**{f"a/f{i}": 1 for i in range(9)}, **{f"b/f{i}": 1 for i in range(8)}}
        | {f"c/f{i}": 1 for i in range(12)}
        | {f"d/f{i}": 1 for i in range(9)}
    )
    (root / ".fan-out-baseline").write_text("# kept\na 12\nb 9\nc 10\n", encoding="utf-8")
    git(root, "rm", "-rq", "b")

    assert run(root, CHECK, "--update-baseline").returncode == 0

    # a lowers to 9, b (now empty) drops, c stays at 10 although it holds 12, d is not added.
    assert (root / ".fan-out-baseline").read_text(encoding="utf-8") == "# kept\na 9\nc 10\n"
