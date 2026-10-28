from typing import TYPE_CHECKING

import pytest

from backend.tests.structure.repo import repo_builder

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


@pytest.fixture
def make_repo(tmp_path: Path) -> Callable[..., Path]:
    return repo_builder(tmp_path)
