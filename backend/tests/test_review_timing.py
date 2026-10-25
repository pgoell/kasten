"""How long the review's first-draw reads take, printed to read a branch against main.

It times and asserts only that each request answers 200. It only GETs, so the
vault it reads is never written to. Off unless `KASTEN_TIMING=1` and
`KASTEN_TIMING_VAULT` names an existing folder, because a timing taken on a
loaded box says nothing about the code, and CI has no vault to time.
"""

import os
import statistics
import time
from datetime import date
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
async def test_807_a11_review_reads_time_on_the_vault_copy(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("KASTEN_VAULT_PATH", TIMING_VAULT)
    get_settings.cache_clear()

    today = date.today()
    params = {"from": date(today.year, 1, 1).isoformat(), "to": today.isoformat()}
    reads: list[tuple[str, str, dict[str, str]]] = [
        ("written notes", "/api/written/notes", params),
        ("written", "/api/written", params),
        ("log", "/api/log", params),
        ("todos", "/api/todos", {}),
        ("cards", "/api/cards", {}),
    ]

    for name, path, query in reads:
        response = await client.get(path, params=query)
        assert response.status_code == 200

        for _ in range(WARM_UP):
            response = await client.get(path, params=query)
            assert response.status_code == 200

        timings: list[float] = []
        items = 0
        for _ in range(RUNS):
            start = time.perf_counter()
            response = await client.get(path, params=query)
            timings.append((time.perf_counter() - start) * 1000)
            assert response.status_code == 200
            items = len(response.json())

        # The ninth of the nine cut points is the 90th percentile.
        p90 = statistics.quantiles(timings, n=10)[8]
        print(f"{name} items={items} median={statistics.median(timings):.1f}ms p90={p90:.1f}ms")
