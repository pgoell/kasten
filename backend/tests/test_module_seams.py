"""Backend modules do not reach into a sibling's private names.

A module that imports `_x` from a sibling shares that sibling's knowledge, so the
seam between them is wider than a deep module should have. See #611 and #698.
"""

import ast
from pathlib import Path

SRC = Path(__file__).parents[1] / "src" / "kasten_backend"


def test_no_module_imports_a_private_name_from_a_sibling() -> None:
    """Every import of a `_name` from `kasten_backend` or a relative module is listed."""
    found: list[str] = []
    for path in sorted(SRC.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom):
                continue
            module = "." * node.level + (node.module or "")
            is_sibling = (
                node.level > 0
                or node.module == "kasten_backend"
                or (node.module or "").startswith("kasten_backend.")
            )
            if not is_sibling:
                continue
            for alias in node.names:
                if alias.name.startswith("_") and not alias.name.startswith("__"):
                    found.append(
                        f"{path.relative_to(SRC.parent)}:{node.lineno}: {alias.name} from {module}"
                    )
    assert found == [], "\n".join(found)
