"""The kasten routes the host jobs read and write, over plain HTTP.

A job runs in a container on the docker network `web` and names the backend
`http://kasten-backend-prod:8000`, inside the trust zone, so it sends no token.
"""

import logging
from typing import Any

import httpx

log = logging.getLogger("kasten_jobs.kasten_api")

BATCH = 1000
"""The most bookings or balances kasten takes in one post."""

ORDER_BATCH = 200
"""The most orders kasten takes in one post."""

PAGE = 5000
"""The most bookings kasten answers one read with."""


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

    def post_orders(self, orders: list[dict[str, Any]]) -> dict[str, int]:
        """`POST /api/finance/orders` in batches, and answer the counts summed over them.

        A batch kasten refuses (a `422`) is sent again order by order, so one
        order it will not take costs only that order; `refused` counts those.
        """
        totals = {"created": 0, "updated": 0, "unchanged": 0, "matched": 0, "refused": 0}
        for start in range(0, len(orders), ORDER_BATCH):
            batch = orders[start : start + ORDER_BATCH]
            for answer in self._orders(batch):
                totals = {key: totals[key] + answer.get(key, 0) for key in totals}
        return totals

    def _orders(self, batch: list[dict[str, Any]]) -> list[dict[str, int]]:
        response = self.client.post("/api/finance/orders", json=batch)
        if response.status_code != httpx.codes.UNPROCESSABLE_ENTITY:
            return [self._json(response)]
        if len(batch) == 1:
            log.warning("kasten refused order %s: %s", batch[0].get("order_key"), response.text)
            return [{"refused": 1}]
        return [answer for order in batch for answer in self._orders([order])]

    def post_balances(self, balances: list[dict[str, Any]]) -> None:
        """`POST /api/finance/balances`."""
        if balances:
            self._json(self.client.post("/api/finance/balances", json=balances))

    def finish_run(self, run_id: int, finish: dict[str, Any]) -> None:
        """`PATCH /api/finance/sync/runs/{run_id}`."""
        self._json(self.client.patch(f"/api/finance/sync/runs/{run_id}", json=finish))

    def accounts(self) -> list[dict[str, Any]]:
        """`GET /api/finance/accounts`."""
        return self._json(self.client.get("/api/finance/accounts"))

    def post_account(self, account: dict[str, Any]) -> dict[str, Any]:
        """`POST /api/finance/accounts`: make the account, or update the one of that name."""
        return self._json(self.client.post("/api/finance/accounts", json=account))

    def bookings(self) -> list[dict[str, Any]]:
        """Every booking, read page by page."""
        rows: list[dict[str, Any]] = []
        while True:
            params: dict[str, Any] = {"limit": PAGE}
            if rows:
                params["after"] = rows[-1]["id"]
            page = self._json(self.client.get("/api/finance/transactions", params=params))
            rows += page
            if len(page) < PAGE:
                return rows

    def categories(self) -> list[dict[str, Any]]:
        """`GET /api/finance/categories`."""
        return self._json(self.client.get("/api/finance/categories"))

    def post_category(self, name: str, kind: str) -> dict[str, Any]:
        """`POST /api/finance/categories`."""
        body = {"name": name, "kind": kind}
        return self._json(self.client.post("/api/finance/categories", json=body))

    def rules(self) -> list[dict[str, Any]]:
        """`GET /api/finance/rules`."""
        return self._json(self.client.get("/api/finance/rules"))

    def post_rule(self, kind: str, pattern: str, category_id: int) -> dict[str, Any]:
        """`POST /api/finance/rules`, which also runs the rules over every booking."""
        body = {"kind": kind, "pattern": pattern, "category_id": category_id}
        return self._json(self.client.post("/api/finance/rules", json=body))

    def run_rules(self) -> int:
        """`POST /api/finance/rules/run`, and answer how many bookings took another category."""
        return self._json(self.client.post("/api/finance/rules/run"))["changed"]

    def set_category(self, transaction_id: int, category_id: int) -> None:
        """`PUT /api/finance/transactions/{id}/category`: set the booking's category by hand."""
        url = f"/api/finance/transactions/{transaction_id}/category"
        self._json(self.client.put(url, json={"category_id": category_id}))

    def post_receipt(self, data: bytes, name: str, source: str) -> dict[str, Any] | None:
        """`POST /api/finance/receipts`: the receipt kept and whether new, or None if refused.

        The same file sent again is the receipt already kept, so a rerun sends
        every attachment again and changes nothing.
        """
        files = {"file": (name, data, "application/octet-stream")}
        response = self.client.post("/api/finance/receipts", files=files, data={"source": source})
        if response.status_code == httpx.codes.UNPROCESSABLE_ENTITY:
            log.warning("kasten refused receipt %s: %s", name, response.text)
            return None
        return self._json(response)

    def unread_receipts(self, after: int | None, limit: int = 20) -> list[dict[str, Any]]:
        """`GET /api/finance/receipts`: receipts not read yet, oldest first, past `after`."""
        params: dict[str, Any] = {"limit": limit}
        if after is not None:
            params["after"] = after
        return self._json(self.client.get("/api/finance/receipts", params=params))

    def receipt_file(self, receipt_id: int) -> bytes:
        """`GET /api/finance/receipts/{id}/file`: the receipt's bytes."""
        response = self.client.get(f"/api/finance/receipts/{receipt_id}/file")
        response.raise_for_status()
        return response.content

    def put_reading(self, receipt_id: int, reading: dict[str, Any]) -> None:
        """`PUT /api/finance/receipts/{id}/reading`: what the reader found, or why nothing."""
        self._json(self.client.put(f"/api/finance/receipts/{receipt_id}/reading", json=reading))
