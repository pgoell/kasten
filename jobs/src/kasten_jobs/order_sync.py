"""The order mail job: read recent PayPal and Amazon mails and send kasten the orders in them.

Kasten stores each order by its id and matches its charges to the bank
bookings; the job only gathers. It reads the last `ORDER_SYNC_DAYS` of mail
every run and sends every order it finds, so a run that fails or a day
missed costs nothing: an order sent again changes nothing. It never writes
to the mailbox. See docs/how-to/run-the-order-sync.md and
docs/reference/order-sync.md.
"""

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

import httpx

from kasten_jobs import orders_amazon, orders_paypal
from kasten_jobs.gmail import Gmail
from kasten_jobs.kasten_api import KastenApi

if TYPE_CHECKING:
    from collections.abc import Mapping
    from datetime import date

    from kasten_jobs.gmail import Mail
    from kasten_jobs.orders_amazon import Confirmation, Item, Shipment
    from kasten_jobs.orders_paypal import Payment, Refund

log = logging.getLogger("kasten_jobs.order_sync")

SENDERS = (orders_amazon.CONFIRMATION, orders_amazon.DISPATCH, orders_paypal.SENDER)


class Mailbox(Protocol):
    """The two reads the job makes."""

    def search(self, query: str) -> list[str]:
        """The ids of the messages a Gmail search finds."""
        ...

    def message(self, message_id: str) -> Mail:
        """One message."""
        ...


@dataclass(frozen=True)
class Settings:
    """What the env file sets. Every name and default is in docs/reference/order-sync.md."""

    api: str
    credentials: Path
    days: int

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        """Read the settings, each with its default."""
        return cls(
            api=env.get("KASTEN_API", "http://kasten-backend-prod:8000"),
            credentials=Path(env.get("ORDER_SYNC_GMAIL_CREDENTIALS", "/gmail.json")),
            days=int(env.get("ORDER_SYNC_DAYS", "60")),
        )


@dataclass
class Found:
    """What the mails of one run held, by order."""

    confirmations: dict[str, Confirmation]
    shipments: list[Shipment]
    payments: dict[str, Payment]
    refunds: list[Refund]
    seen: set[str]
    skipped: int = 0


def _sender(mail: Mail) -> str:
    return mail.sender.rsplit("<", 1)[-1].rstrip(">").strip().lower()


PARSE_ERRORS = (ValueError, ArithmeticError, IndexError, KeyError, UnicodeError)
"""What a parser raises on a mail in a shape it did not expect, such as an amount it cannot read."""


def read(mailbox: Mailbox, query: str, found: Found) -> None:
    """Parse every mail the search finds into `found`.

    A mail in no known shape is passed over. One that Gmail will not hand
    over, or that breaks a parser, is skipped and counted, so one odd mail
    never costs the run.
    """
    for message_id in mailbox.search(query):
        if message_id in found.seen:
            continue
        found.seen.add(message_id)
        try:
            _parse(mailbox.message(message_id), found)
        except (*PARSE_ERRORS, httpx.HTTPStatusError) as error:
            found.skipped += 1
            log.warning("Skipped mail %s: %s", message_id, error)


def _parse(mail: Mail, found: Found) -> None:
    """Put one mail's order, shipment, payment or refund into `found`."""
    sender = _sender(mail)
    if sender == orders_amazon.CONFIRMATION:
        for order in orders_amazon.parse_confirmation(mail):
            found.confirmations.setdefault(order.order_id, order)
    elif sender == orders_amazon.DISPATCH:
        if (shipment := orders_amazon.parse_shipment(mail)) is not None:
            found.shipments.append(shipment)
        else:
            log.warning("Skipped Amazon dispatch mail %s: no one order with items", mail.id)
    elif sender == orders_paypal.SENDER:
        if (refund := orders_paypal.parse_refund(mail)) is not None:
            found.refunds.append(refund)
        elif (payment := orders_paypal.parse_payment(mail)) is not None:
            if _to_amazon(payment.merchant):
                # Amazon's own mails say more, item by item and per shipment.
                log.info("Left out PayPal payment %s to Amazon", payment.code)
            else:
                found.payments.setdefault(payment.code, payment)


def _to_amazon(merchant: str) -> bool:
    """A PayPal payment to Amazon, which Amazon's own mails cover item by item."""
    return merchant.casefold().startswith("amazon")


def _gmail_day(day: date) -> str:
    return day.strftime("%Y/%m/%d")


def _first_word(text: str) -> str:
    return (text.split() or [""])[0].lower()


def _refunded(refund: Refund, payments: dict[str, Payment]) -> Payment | None:
    """The payment a refund names by its day, amount and the merchant's first word."""
    for payment in payments.values():
        if (
            payment.total == refund.paid
            and abs((payment.day - refund.paid_on).days) <= 1
            and _first_word(payment.merchant) == _first_word(refund.merchant)
        ):
            return payment
    return None


def complete(mailbox: Mailbox, found: Found) -> None:
    """Fetch what the window left out: a shipment's confirmation, a refund's payment.

    Both came earlier than what names them, so they fall out of the window
    first.
    """
    for order_id in {s.order_id for s in found.shipments} - found.confirmations.keys():
        read(mailbox, f'from:{orders_amazon.CONFIRMATION} "{order_id}"', found)
    for refund in found.refunds:
        if _refunded(refund, found.payments) is None:
            after = _gmail_day(refund.paid_on - timedelta(days=1))
            before = _gmail_day(refund.paid_on + timedelta(days=2))
            read(mailbox, f"from:{orders_paypal.SENDER} after:{after} before:{before}", found)


TEXT = 500
"""The longest item text kasten takes."""


def _items(items: list[Item]) -> list[dict[str, str]]:
    return [{"text": text[:TEXT], "amount": str(amount)} for text, amount in items]


def _amazon(found: Found) -> list[dict[str, Any]]:
    orders: dict[str, dict[str, Any]] = {}
    for order_id, confirmation in found.confirmations.items():
        charges = []
        if confirmation.items is not None and confirmation.total:
            charges.append(
                {
                    "key": "order",
                    "charged_on": confirmation.day.isoformat(),
                    "amount": str(confirmation.total),
                    "items": _items(confirmation.items),
                }
            )
        orders[order_id] = {
            "source": "amazon",
            "order_key": order_id,
            "ordered_on": confirmation.day.isoformat(),
            "merchant": "Amazon",
            "total": None if confirmation.total is None else str(confirmation.total),
            "charges": charges,
        }
    for shipment in found.shipments:
        order: dict[str, Any] | None = orders.get(shipment.order_id)
        if order is None:
            # No confirmation, even searched for: the shipment's day stands in.
            log.warning("No confirmation for Amazon order %s", shipment.order_id)
            order = orders[shipment.order_id] = {
                "source": "amazon",
                "order_key": shipment.order_id,
                "ordered_on": shipment.day.isoformat(),
                "merchant": "Amazon",
                "total": None,
                "charges": [],
            }
        order["charges"].append(
            {
                "key": shipment.mail_id,
                "charged_on": shipment.day.isoformat(),
                "amount": str(shipment.amount),
                "items": _items(shipment.items),
            }
        )
    return list(orders.values())


def _paypal(found: Found) -> list[dict[str, Any]]:
    orders: dict[str, dict[str, Any]] = {
        code: {
            "source": "paypal",
            "order_key": code,
            "ordered_on": payment.day.isoformat(),
            "merchant": payment.merchant,
            "total": str(payment.total),
            "charges": [
                {
                    "key": "payment",
                    "charged_on": payment.day.isoformat(),
                    "amount": str(payment.total),
                    "items": _items(payment.items),
                }
            ],
        }
        for code, payment in found.payments.items()
    }
    for refund in found.refunds:
        if _to_amazon(refund.merchant):
            continue
        payment = _refunded(refund, found.payments)
        if payment is None:
            log.warning("No payment found for the PayPal refund in mail %s", refund.mail_id)
            continue
        orders[payment.code]["charges"].append(
            {
                "kind": "refund",
                "key": refund.mail_id,
                "charged_on": refund.day.isoformat(),
                "amount": str(refund.amount),
            }
        )
    return list(orders.values())


def gather_found(mailbox: Mailbox, days: int) -> Found:
    """What the last `days` of mail hold, and how many mails were skipped."""
    found = Found({}, [], {}, [], set())
    senders = " OR ".join(SENDERS)
    read(mailbox, f"from:({senders}) newer_than:{days}d", found)
    complete(mailbox, found)
    return found


def gather(mailbox: Mailbox, days: int) -> list[dict[str, Any]]:
    """Every order the last `days` of mail hold, as `POST /api/finance/orders` takes them."""
    found = gather_found(mailbox, days)
    return _amazon(found) + _paypal(found)


def sync(api: KastenApi, mailbox: Mailbox, days: int) -> int:
    """Gather the orders and send them; 1 only when there were orders and kasten took none."""
    found = gather_found(mailbox, days)
    orders = _amazon(found) + _paypal(found)
    stored = api.post_orders(orders)
    log.info(
        "Sent %d orders: %d new, %d changed, %d as they were, %d refused; %d charges matched;"
        " %d mails skipped",
        len(orders),
        stored["created"],
        stored["updated"],
        stored["unchanged"],
        stored["refused"],
        stored["matched"],
        found.skipped,
    )
    return 1 if orders and stored["refused"] == len(orders) else 0


def main(argv: list[str] | None = None) -> int:
    """Read the env, run the command, and answer its exit code."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    # httpx logs each request's URL at INFO, and a Gmail search's URL holds the query.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(prog="kasten-order-sync")
    commands = parser.add_subparsers(dest="command", required=True)
    for name, text in (
        ("sync", "read the recent order mails and send the orders to kasten"),
        ("show", "print the orders the recent mails hold as JSON, and send nothing"),
    ):
        command = commands.add_parser(name, help=text)
        command.add_argument("--days", type=int, help="how far back to read; ORDER_SYNC_DAYS")
    args = parser.parse_args(argv)

    settings = Settings.from_env(os.environ)
    days = args.days or settings.days
    with httpx.Client(timeout=30) as google:
        mailbox = Gmail.from_file(google, settings.credentials)
        if args.command == "show":
            json.dump(gather(mailbox, days), sys.stdout, indent=2, ensure_ascii=False)
            return 0
        with httpx.Client(base_url=settings.api, timeout=60) as client:
            return sync(KastenApi(client), mailbox, days)


if __name__ == "__main__":
    sys.exit(main())
