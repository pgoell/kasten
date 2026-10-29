"""scripts/structure/check-comments: the comment ratio and the long docstrings."""

import sys
from typing import TYPE_CHECKING

from backend.tests.structure.repo import REPO, run

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

CHECK = [sys.executable, "scripts/structure/check-comments"]
CODE = "x = 1\n" * 20
TS_CODE = "const x = 1;\n" * 20


def put(root: Path, name: str, text: str) -> None:
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    (root / name).write_text(text, encoding="utf-8")


def doc(lines: int) -> str:
    return '"""' + "\n" * (lines - 1) + '"""\n'


def test_the_repo_passes() -> None:
    result = run(REPO, *CHECK)
    assert result.returncode == 0, result.stderr


def test_a_dense_file_fails(make_repo: Callable[..., Path]) -> None:
    root = make_repo()
    put(root, "backend/src/a.py", "# why\n" * 6 + CODE)  # 6 of 26 is 23%
    result = run(root, *CHECK)
    assert result.returncode == 1
    assert "comments: backend/src/a.py is 23% comment lines; the limit is 20%." in result.stderr
    assert "do not move it or raise a baseline" in result.stderr


def test_a_small_or_sparse_file_passes(make_repo: Callable[..., Path]) -> None:
    root = make_repo()
    put(root, "backend/src/small.py", "# why\nx = 1\n")
    put(root, "backend/src/sparse.py", "# why\n" * 5 + CODE)  # 5 of 25 is 20%
    assert run(root, *CHECK).returncode == 0


def test_docstrings_jsdoc_and_trailing_comments_are_not_counted(
    make_repo: Callable[..., Path],
) -> None:
    root = make_repo()
    put(root, "backend/src/a.py", doc(5) + "x = 1  # why\n" * 20)
    put(root, "frontend/src/a.ts", "/**\n * What.\n */\n" * 3 + TS_CODE)
    assert run(root, *CHECK).returncode == 0


def test_comment_markers_inside_strings_are_code(make_repo: Callable[..., Path]) -> None:
    root = make_repo()
    lines = [
        'const a = "http://x";',
        "const b = `/* ${'//'} */`;",
        "const c = /\\/\\//.test(a);",
        "const d = `${a}` // why",
        "const e = 4 / 2 / 1;",
    ]
    put(root, "frontend/src/a.ts", "\n".join(lines * 5) + "\n")
    put(root, "frontend/src/b.tsx", "{/* why */}\n" * 6 + TS_CODE)
    result = run(root, *CHECK)
    assert result.returncode == 1
    assert "frontend/src/a.ts" not in result.stderr
    assert "comments: frontend/src/b.tsx is 23% comment lines" in result.stderr


def test_growth_past_a_baseline_line_fails(make_repo: Callable[..., Path]) -> None:
    root = make_repo()
    (root / ".comment-ratio-baseline").write_text("backend/src/a.py 23\n", encoding="utf-8")
    put(root, "backend/src/a.py", "# why\n" * 6 + CODE)
    assert run(root, *CHECK).returncode == 0

    put(root, "backend/src/a.py", "# why\n" * 7 + CODE)
    result = run(root, *CHECK)
    assert result.returncode == 1
    assert "is 25% comment lines; the limit is 20% and its baseline is 23%." in result.stderr


def test_a_new_long_docstring_fails(make_repo: Callable[..., Path]) -> None:
    root = make_repo()
    put(root, "backend/src/a.py", doc(6) + "def f():\n" + "    " + doc(6) + "    return 1\n")
    put(root, "frontend/src/a.ts", "/**\n" + " *\n" * 4 + " */\n" + TS_CODE)
    assert run(root, *CHECK).returncode == 0

    put(root, "backend/src/a.py", doc(6) + "def f():\n" + "    " + doc(7) + "    return 1\n")
    put(root, "frontend/src/a.ts", "/**\n" + " *\n" * 5 + " */\n" + TS_CODE)
    result = run(root, *CHECK)
    assert result.returncode == 1
    assert "comments: backend/src/a.py has 1 docstrings or JSDoc blocks over 6 lines;" in (
        result.stderr
    )
    assert "comments: frontend/src/a.ts has 1 docstrings" in result.stderr


def test_a_file_may_keep_its_baselined_long_docstrings(make_repo: Callable[..., Path]) -> None:
    root = make_repo()
    (root / ".long-docstring-baseline").write_text("backend/src/a.py 1\n", encoding="utf-8")
    put(root, "backend/src/a.py", doc(9) + CODE)
    assert run(root, *CHECK).returncode == 0

    put(root, "backend/src/a.py", doc(9) + "class C:\n    " + doc(9) + CODE)
    assert "has 2 docstrings or JSDoc blocks over 6 lines; its baseline is 1." in (
        run(root, *CHECK).stderr
    )


def test_update_lowers_and_drops_but_never_raises_or_adds(make_repo: Callable[..., Path]) -> None:
    root = make_repo()
    (root / ".comment-ratio-baseline").write_text(
        "backend/src/a.py 40\nbackend/src/gone.py 30\nbackend/src/b.py 21\n", encoding="utf-8"
    )
    (root / ".long-docstring-baseline").write_text("backend/src/a.py 3\n", encoding="utf-8")
    put(root, "backend/src/a.py", doc(9) + "# why\n" * 6 + CODE)
    put(root, "backend/src/b.py", "# why\n" * 10 + CODE)
    put(root, "backend/src/new.py", doc(9) + "# why\n" * 10 + CODE)

    assert run(root, *CHECK, "--update-baseline").returncode == 0

    ratios = (root / ".comment-ratio-baseline").read_text(encoding="utf-8")
    docs = (root / ".long-docstring-baseline").read_text(encoding="utf-8")
    assert [line for line in ratios.splitlines() if not line.startswith("#")] == [
        "backend/src/a.py 23",
        "backend/src/b.py 21",
    ]
    assert [line for line in docs.splitlines() if not line.startswith("#")] == [
        "backend/src/a.py 1"
    ]


def test_a_missing_baseline_is_written_from_todays_overages(
    make_repo: Callable[..., Path],
) -> None:
    root = make_repo()
    put(root, "jobs/src/a.py", doc(9) + "# why\n" * 6 + CODE)
    put(root, "docs/a.py", doc(9) + "# why\n" * 6 + CODE)  # outside the checked folders

    assert run(root, *CHECK, "--update-baseline").returncode == 0

    assert "jobs/src/a.py 23\n" in (root / ".comment-ratio-baseline").read_text(encoding="utf-8")
    assert (
        (root / ".long-docstring-baseline")
        .read_text(encoding="utf-8")
        .endswith("lines; never raise one.\njobs/src/a.py 1\n")
    )
