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


# The largest deck of the live vault, an imported Anki deck; any note path works.
DECK = os.environ.get("KASTEN_TIMING_DECK", "99 Misc/01 Config/decks.md")
BOARD_RUNS = 20


@pytest.mark.skipif(
    os.environ.get("KASTEN_TIMING") != "1" or not TIMING_VAULT or not Path(TIMING_VAULT).is_dir(),
    reason="timing needs KASTEN_TIMING=1 and KASTEN_TIMING_VAULT set to an existing folder, "
    "a copy of the vault, which CI does not have",
)
async def test_1321_a2_board_and_review_reads_time_on_the_vault_copy(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("KASTEN_VAULT_PATH", TIMING_VAULT)
    get_settings.cache_clear()

    reads: list[tuple[str, str]] = [
        ("todos", "/api/todos"),
        ("cards", "/api/cards"),
        ("review limits", "/api/review/limits"),
        ("files", "/api/files"),
        ("todo views note", "/api/files/99 Misc/01 Config/todo-views.md"),
        ("decks note", "/api/files/99 Misc/01 Config/decks.md"),
        ("deck note", f"/api/files/{DECK}"),
    ]

    for name, path in reads:
        for _ in range(WARM_UP):
            response = await client.get(path)
            assert response.status_code == 200, (name, response.status_code)

        timings: list[float] = []
        for _ in range(BOARD_RUNS):
            start = time.perf_counter()
            response = await client.get(path)
            timings.append((time.perf_counter() - start) * 1000)
            assert response.status_code == 200
        body = response.json()
        size = len(body) if isinstance(body, list) else len(response.content)

        # The 19th of the 19 cut points is the 95th percentile.
        p95 = statistics.quantiles(timings, n=20)[18]
        load = os.getloadavg()[0]
        print(
            f"TIMING {name} size={size} p50={statistics.median(timings):.1f}ms "
            f"p95={p95:.1f}ms load1={load:.2f}"
        )
