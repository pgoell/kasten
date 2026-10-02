"""What the backend says at startup about a setup that leaves something open.

Warnings and never a refusal: dev from a fresh checkout runs with both gaps, and
it has to keep starting.
"""

from typing import TYPE_CHECKING

from kasten_backend.config import Settings
from kasten_backend.main import warn_unsafe

if TYPE_CHECKING:
    from pathlib import Path

    import pytest


def test_warns_about_an_empty_agent_host_and_an_unversioned_vault(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    warn_unsafe(Settings(agent_host="", vault_path=tmp_path))

    assert "KASTEN_AGENT_HOST is empty" in caplog.text
    assert "no .jj directory" in caplog.text


def test_says_nothing_about_a_setup_like_production(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    (tmp_path / ".jj").mkdir()

    warn_unsafe(Settings(agent_host="kasten.example.com", vault_path=tmp_path))

    assert caplog.text == ""
