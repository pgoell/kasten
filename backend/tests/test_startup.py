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
    # A folder of its own: the upload folder conftest sets is `tmp_path /
    # "uploads"`, and settings refuse one inside the vault.
    warn_unsafe(Settings(agent_host="", vault_path=tmp_path / "vault"))

    assert "KASTEN_AGENT_HOST is empty" in caplog.text
    assert "no .jj directory" in caplog.text


def test_says_nothing_about_a_setup_like_production(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    vault = tmp_path / "vault"
    (vault / ".jj").mkdir(parents=True)

    warn_unsafe(Settings(agent_host="kasten.example.com", vault_path=vault))

    assert caplog.text == ""
