"""The kasten routes the bank sync reads and writes, over plain HTTP.

The job runs in a container on the docker network `web` and names the backend
`http://kasten-backend-prod:8000`, inside the trust zone, so it sends no token.
"""

from typing import Any

import httpx

BATCH = 1000
"""The most bookings or balances kasten takes in one post."""


class KastenApi:
    """The finance and sync routes, each a method that raises on an answer it did not expect."""

    def __init__(self, client: httpx.Client) -> None:
        """Wrap a client whose `base_url` is the backend."""
        self.client = client

    def _json(self, response: httpx.Response) -> Any:
        response.raise_for_status()
        return response.json()

    def status(self) -> dict[str, Any]:
        """`GET /api/finance/sync`: the open request, the last run, and every account."""
        return self._json(self.client.get("/api/finance/sync"))

    def request_open(self) -> bool:
        """`GET /api/finance/sync/requests/open`: whether a "pull now" waits."""
        response = self.client.get("/api/finance/sync/requests/open")
        if response.status_code == httpx.codes.NOT_FOUND:
            return False
        response.raise_for_status()
        return True

    def start_run(self, trigger: str) -> dict[str, Any] | None:
        """Start a run and claim the open requests, or None when another run has them."""
        response = self.client.post("/api/finance/sync/runs", json={"trigger": trigger})
        if response.status_code == httpx.codes.CONFLICT:
            return None
        return self._json(response)["run"]

    def post_bookings(self, bookings: list[dict[str, Any]]) -> tuple[int, int]:
        """Send the bookings in batches, and answer how many were new and how many known."""
        created = skipped = 0
        for start in range(0, len(bookings), BATCH):
            answer = self._json(
                self.client.post("/api/finance/transactions", json=bookings[start : start + BATCH])
            )
            created += answer["created"]
            skipped += answer["skipped"]
        return created, skipped

    def post_balances(self, balances: list[dict[str, Any]]) -> None:
        """`POST /api/finance/balances`."""
        if balances:
            self._json(self.client.post("/api/finance/balances", json=balances))

    def finish_run(self, run_id: int, finish: dict[str, Any]) -> None:
        """`PATCH /api/finance/sync/runs/{run_id}`."""
        self._json(self.client.patch(f"/api/finance/sync/runs/{run_id}", json=finish))
