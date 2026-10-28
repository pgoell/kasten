"""The OpenAPI dump script, run in-process against the app.

The dumped schema is committed, so it must not carry the release number.
"""

import json
import runpy  # noqa: TID251 the script runs in-process, as it would as __main__
from pathlib import Path
from typing import TYPE_CHECKING

from kasten_backend import main

if TYPE_CHECKING:
    import pytest

SCRIPT = Path(__file__).parents[2] / "scripts" / "dump_openapi.py"


def test_dumped_schema_carries_no_release_number(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(main.app, "version", "9.8.7")
    monkeypatch.setattr(main.app, "openapi_schema", None)

    runpy.run_path(str(SCRIPT))

    out = capsys.readouterr().out
    assert json.loads(out)["info"]["version"] == "0.0.0"
