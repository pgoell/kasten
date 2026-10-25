"""How long the overview pane's first-draw reads take, printed to read a branch against main.

It times and asserts only that each request answers 200, except `/api/written`,
which may answer 404 on a branch without it. It only GETs, so the vault it
reads is never written to. Off unless `KASTEN_TIMING=1` and `KASTEN_TIMING_VAULT`
names an existing folder, because a timing taken on a loaded box says nothing
about the code, and CI has no vault to time.
"""

import os
import statistics
import time
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from httpx import AsyncClient

TIMING_VAULT = os.environ.get("KASTEN_TIMING_VAULT", "")
WARM_UP = 3
RUNS = 30


@pytest.mark.skipif(
    os.environ.get("KASTEN_TIMING") != "1" or not TIMING_VAULT or not Path(TIMING_VAULT).is_dir(),
    reason="timing needs KASTEN_TIMING=1 and KASTEN_TIMING_VAULT set to an existing folder, "
    "a copy of the vault, which CI does not have",
)
async def test_overview_reads_time_on_the_vault_copy(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("KASTEN_VAULT_PATH", TIMING_VAULT)
    get_settings.cache_clear()

    today = date.today()
    last_90 = (today - timedelta(days=89)).isoformat()
    this_year = date(today.year, 1, 1).isoformat()
    reads: list[tuple[str, str, dict[str, str]]] = [
        ("log", "/api/log", {"from": last_90, "to": today.isoformat()}),
        ("todos", "/api/todos", {}),
        ("cards", "/api/cards", {}),
        ("written", "/api/written", {"from": this_year, "to": today.isoformat()}),
    ]

    for name, path, params in reads:
        response = await client.get(path, params=params)
        if name == "written" and response.status_code == 404:
            print("written: not on this branch")
            continue
        assert response.status_code == 200

        for _ in range(WARM_UP):
            response = await client.get(path, params=params)
            assert response.status_code == 200

        timings: list[float] = []
        items = 0
        for _ in range(RUNS):
            start = time.perf_counter()
            response = await client.get(path, params=params)
            timings.append((time.perf_counter() - start) * 1000)
            assert response.status_code == 200
            items = len(response.json())

        # The ninth of the nine cut points is the 90th percentile.
        p90 = statistics.quantiles(timings, n=10)[8]
        print(f"{name} items={items} median={statistics.median(timings):.1f}ms p90={p90:.1f}ms")
