"""Kasten's sync and finance routes as an in-memory `httpx.MockTransport`.

It answers what the job reads and keeps what it writes, so a test reads back
the bookings, balances and finish a run sent.
"""

import json
from dataclasses import dataclass, field
from typing import Any

import httpx

from kasten_jobs.kasten_api import KastenApi


@dataclass
class FakeKasten:
    """The status the job reads, and every write it sends."""

    accounts: list[dict[str, Any]]
    requested: bool = True
    busy: bool = False
    bookings: list[dict[str, Any]] = field(default_factory=list)
    balances: list[dict[str, Any]] = field(default_factory=list)
    finishes: list[dict[str, Any]] = field(default_factory=list)
    days_since_success: int | None = 0
    refuse: set[int] = field(default_factory=set)
    status_reads: int = 0
    orders: list[list[dict[str, Any]]] = field(default_factory=list)

    def handle(self, request: httpx.Request) -> httpx.Response:
        route = {
            ("GET", "/api/finance/sync"): self._status,
            ("GET", "/api/finance/sync/requests/open"): self._open,
            ("POST", "/api/finance/sync/runs"): self._start,
            ("POST", "/api/finance/transactions"): self._bookings,
            ("POST", "/api/finance/balances"): self._balances,
            ("PATCH", "/api/finance/sync/runs/7"): self._finish,
            ("POST", "/api/finance/orders"): self._orders,
        }.get((request.method, request.url.path))
        if route is None:
            return httpx.Response(404, json={"detail": f"no fake for {request.url.path}"})
        return route(json.loads(request.content) if request.content else None)

    def _open(self, _body: Any) -> httpx.Response:
        if self.requested:
            return httpx.Response(200, json={"id": 1, "run_id": None})
        return httpx.Response(404, json={"detail": "No sync request is open"})

    def _status(self, _body: Any) -> httpx.Response:
        self.status_reads += 1
        return httpx.Response(
            200,
            json={
                "requested_at": "2026-10-25T08:00:00Z" if self.requested else None,
                "days_since_success": self.days_since_success,
                "accounts": self.accounts,
            },
        )

    def _start(self, _body: Any) -> httpx.Response:
        if self.busy:
            return httpx.Response(409, json={"detail": "Run 1 has not finished"})
        return httpx.Response(200, json={"run": {"id": 7}, "claimed": 1})

    def _bookings(self, body: Any) -> httpx.Response:
        if refused := {b["account_id"] for b in body} & self.refuse:
            return httpx.Response(422, json={"detail": f"No account with id {min(refused)}"})
        known = {b["source_key"] for b in self.bookings}
        new = [b for b in body if b["source_key"] not in known]
        self.bookings += new
        answer = {"created": len(new), "skipped": len(body) - len(new), "linked": 0}
        return httpx.Response(200, json=answer)

    def _balances(self, body: Any) -> httpx.Response:
        self.balances += body
        return httpx.Response(200, json={"stored": len(body)})

    def _finish(self, body: Any) -> httpx.Response:
        self.finishes.append(body)
        return httpx.Response(200, json={"id": 7})

    def _orders(self, body: Any) -> httpx.Response:
        self.orders.append(body)
        answer = {"created": len(body), "updated": 0, "unchanged": 0, "matched": 1}
        return httpx.Response(200, json=answer)

    def api(self) -> KastenApi:
        client = httpx.Client(base_url="http://kasten", transport=httpx.MockTransport(self.handle))
        return KastenApi(client)


def account(account_id: int, iban: str, through: str | None = None, newest: str | None = None):
    """A status row as `GET /api/finance/sync` answers it."""
    return {
        "account_id": account_id,
        "name": f"Account {account_id}",
        "iban": iban,
        "last_good_through": through,
        "last_good_at": None,
        "days_since_success": None,
        "newest_booking": newest,
    }
