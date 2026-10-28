"""The order mail job against a fake mailbox, a fake Gmail and a fake kasten."""

import base64
import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import TYPE_CHECKING

import httpx
import pytest

from kasten_jobs import order_sync, orders_amazon
from kasten_jobs.gmail import Gmail, GmailAuthError, Mail, to_mail
from kasten_jobs.kasten_api import ORDER_BATCH

from .fake_kasten import FakeKasten  # noqa: TID252
from .order_mails import (  # noqa: TID252
    CONFIRMATION,
    DIGITAL,
    DISPATCH,
    REFUND,
    SHOP_PAYMENT,
    amazon_mail,
    paypal_mail,
)

if TYPE_CHECKING:
    from collections.abc import Callable

EARLIER = date(2026, 9, 1)


@dataclass
class FakeMailbox:
    """Mails by id, and which search finds which ids. A search not listed finds nothing."""

    mails: dict[str, Mail]
    found: dict[str, list[str]]
    searches: list[str] = field(default_factory=list)
    fetched: list[str] = field(default_factory=list)

    def search(self, query: str) -> list[str]:
        self.searches.append(query)
        return self.found.get(query, [])

    def message(self, message_id: str) -> Mail:
        self.fetched.append(message_id)
        return self.mails[message_id]


RECENT = (
    "from:(bestellbestaetigung@amazon.de OR versandbestaetigung@amazon.de OR service@paypal.de)"
    " newer_than:60d"
)


def mailbox(recent: list[Mail], *older: tuple[str, list[Mail]]) -> FakeMailbox:
    mails = {m.id: m for m in recent} | {m.id: m for _, ms in older for m in ms}
    found = {RECENT: [m.id for m in recent]} | {q: [m.id for m in ms] for q, ms in older}
    return FakeMailbox(mails, found)


def test_an_amazon_order_carries_one_charge_per_dispatch_and_its_total() -> None:
    box = mailbox(
        [
            amazon_mail("conf", orders_amazon.CONFIRMATION, CONFIRMATION),
            amazon_mail("ship", orders_amazon.DISPATCH, DISPATCH),
        ]
    )

    orders = order_sync.gather(box, 60)

    assert orders == [
        {
            "source": "amazon",
            "order_key": "111-2223334-4445556",
            "ordered_on": "2026-10-20",
            "merchant": "Amazon",
            "total": "40.00",
            "charges": [
                {
                    "key": "ship",
                    "charged_on": "2026-10-20",
                    "amount": "27.00",
                    "items": [
                        {"text": "Garden hose, 20 m, green", "amount": "24.50"},
                        {"text": "2 x Hose clip", "amount": "2.50"},
                    ],
                }
            ],
        }
    ]


def test_a_digital_order_is_charged_whole_with_no_dispatch() -> None:
    box = mailbox([amazon_mail("conf", orders_amazon.CONFIRMATION, DIGITAL)])

    [order] = order_sync.gather(box, 60)

    assert order["charges"] == [
        {
            "key": "order",
            "charged_on": "2026-10-20",
            "amount": "8.99",
            "items": [{"text": "A Novel About Gardens (English Edition)", "amount": "8.99"}],
        }
    ]


def test_a_dispatch_whose_confirmation_is_older_than_the_window_looks_it_up() -> None:
    query = 'from:bestellbestaetigung@amazon.de "111-2223334-4445556"'
    box = mailbox(
        [amazon_mail("ship", orders_amazon.DISPATCH, DISPATCH)],
        (query, [amazon_mail("conf", orders_amazon.CONFIRMATION, CONFIRMATION, EARLIER)]),
    )

    [order] = order_sync.gather(box, 60)

    assert (order["ordered_on"], order["total"]) == ("2026-09-01", "40.00")
    assert query in box.searches


def test_a_dispatch_with_no_confirmation_anywhere_still_sends_its_charge() -> None:
    box = mailbox([amazon_mail("ship", orders_amazon.DISPATCH, DISPATCH)])

    [order] = order_sync.gather(box, 60)

    assert (order["ordered_on"], order["total"], len(order["charges"])) == ("2026-10-20", None, 1)


def test_a_paypal_refund_joins_the_payment_it_names() -> None:
    box = mailbox([paypal_mail("pay", SHOP_PAYMENT), paypal_mail("back", REFUND)])

    [order] = order_sync.gather(box, 60)

    assert order["order_key"] == "1AB23456CD789012E"
    assert [(c.get("kind", "charge"), c["key"], c["amount"]) for c in order["charges"]] == [
        ("charge", "payment", "36.40"),
        ("refund", "back", "11.50"),
    ]


def test_a_refund_whose_payment_is_older_than_the_window_finds_it_by_its_day() -> None:
    query = "from:service@paypal.de after:2026/10/19 before:2026/10/22"
    box = mailbox(
        [paypal_mail("back", REFUND)],
        (query, [paypal_mail("pay", SHOP_PAYMENT), paypal_mail("back", REFUND)]),
    )

    [order] = order_sync.gather(box, 60)

    assert [c["key"] for c in order["charges"]] == ["payment", "back"]
    # The refund mail the day's search found again is read once.
    assert box.fetched.count("back") == 1


def test_a_refund_with_no_payment_found_is_left_out(caplog: pytest.LogCaptureFixture) -> None:
    box = mailbox([paypal_mail("back", REFUND)])

    with caplog.at_level(logging.WARNING):
        assert order_sync.gather(box, 60) == []

    assert "No payment found for the PayPal refund in mail back" in caplog.text


def test_mail_from_other_senders_is_ignored() -> None:
    other = Mail("x", date(2026, 10, 20), "News <news@example.com>", "Hi", "Order #", "")

    assert order_sync.gather(mailbox([other]), 60) == []


def test_sync_sends_the_orders_in_batches_and_sums_what_kasten_did() -> None:
    kasten = FakeKasten(accounts=[])
    mails = [
        amazon_mail(
            f"d{n}",
            orders_amazon.CONFIRMATION,
            DIGITAL.replace("1234567-7654321", f"1234567-{n:07d}"),
        )
        for n in range(ORDER_BATCH + 1)
    ]

    assert order_sync.sync(kasten.api(), mailbox(mails), 60) == 0

    assert [len(batch) for batch in kasten.orders] == [ORDER_BATCH, 1]


def _encoded(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


def google(handler: Callable[[httpx.Request], httpx.Response]) -> Gmail:
    login = {"client_id": "id", "client_secret": "secret", "refresh_token": "refresh"}
    return Gmail(httpx.Client(transport=httpx.MockTransport(handler)), login)


def test_gmail_trades_the_refresh_token_once_and_pages_through_a_search() -> None:
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.host == "oauth2.googleapis.com":
            assert b"grant_type=refresh_token" in request.content
            return httpx.Response(200, json={"access_token": "access"})
        assert request.headers["authorization"] == "Bearer access"
        if request.url.params.get("pageToken") == "2":
            return httpx.Response(200, json={"messages": [{"id": "c"}]})
        return httpx.Response(
            200, json={"messages": [{"id": "a"}, {"id": "b"}], "nextPageToken": "2"}
        )

    assert google(handle).search("from:x") == ["a", "b", "c"]
    assert seen.count("/token") == 1


def test_a_refused_login_says_so() -> None:
    gmail = google(lambda _: httpx.Response(400, json={"error": "invalid_grant"}))

    with pytest.raises(GmailAuthError, match="invalid_grant"):
        gmail.search("from:x")


def test_a_message_reads_both_bodies_from_its_parts_and_its_local_day() -> None:
    sent = datetime(2026, 10, 20, 23, 30).astimezone()
    message = {
        "id": "m",
        "internalDate": str(int(sent.timestamp() * 1000)),
        "payload": {
            "mimeType": "multipart/alternative",
            "headers": [
                {"name": "From", "value": "Shop <shop@example.com>"},
                {"name": "Subject", "value": "Hi"},
            ],
            "parts": [
                {"mimeType": "text/plain", "body": {"data": _encoded("Grüße")}},
                {"mimeType": "text/html", "body": {"data": _encoded("<p>Grüße</p>")}},
            ],
        },
    }

    mail = to_mail(json.loads(json.dumps(message)))

    assert mail == Mail(
        "m", date(2026, 10, 20), "Shop <shop@example.com>", "Hi", "Grüße", "<p>Grüße</p>"
    )
