"""How long `GET /api/search` takes on the dev vault, printed for a branch to be read against main.

It times and asserts only that each request answers 200, so it passes on any
branch. Off unless `KASTEN_TIMING=1`, because a timing taken on a loaded box
says nothing about the code, and CI has no dev vault to time.
"""

import os
import statistics
import time
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from httpx import AsyncClient

DEV_VAULT = Path("/home/pascal/Code/kasten/vault")
WORDS = ("the", "kasten", "todo")
WARM_UP = 3
RUNS = 30


@pytest.mark.skipif(
    os.environ.get("KASTEN_TIMING") != "1" or not DEV_VAULT.exists(),
    reason="timing needs KASTEN_TIMING=1 and the dev vault, which CI does not have",
)
async def test_search_times_on_the_dev_vault(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("KASTEN_VAULT_PATH", str(DEV_VAULT))
    get_settings.cache_clear()

    for word in WORDS:
        for _ in range(WARM_UP):
            response = await client.get("/api/search", params={"q": word})
            assert response.status_code == 200

        timings: list[float] = []
        hits = 0
        for _ in range(RUNS):
            start = time.perf_counter()
            response = await client.get("/api/search", params={"q": word})
            timings.append((time.perf_counter() - start) * 1000)
            assert response.status_code == 200
            hits = len(response.json())

        # The ninth of the nine cut points is the 90th percentile.
        p90 = statistics.quantiles(timings, n=10)[8]
        print(f"{word!r} hits={hits} median={statistics.median(timings):.1f}ms p90={p90:.1f}ms")
