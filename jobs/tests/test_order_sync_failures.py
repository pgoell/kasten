"""The order mail job when a mail or an order goes wrong: it skips that one and carries on."""

import logging
from typing import TYPE_CHECKING

from kasten_jobs import order_sync, orders_amazon

from .fake_kasten import FakeKasten
from .order_mails import DIGITAL, SHOP_PAYMENT, amazon_mail, paypal_mail
from .test_order_sync import mailbox

if TYPE_CHECKING:
    import pytest

    from kasten_jobs.gmail import Mail


def digital(n: int) -> Mail:
    text = DIGITAL.replace("1234567-7654321", f"1234567-{n:07d}")
    return amazon_mail(f"d{n}", orders_amazon.CONFIRMATION, text)


def test_a_mail_that_breaks_its_parser_is_skipped_and_counted(
    caplog: pytest.LogCaptureFixture,
) -> None:
    broken = amazon_mail("bad", orders_amazon.CONFIRMATION, DIGITAL.replace("8,99", "8,9,9"))
    kasten = FakeKasten(accounts=[])

    with caplog.at_level(logging.INFO):
        assert order_sync.sync(kasten.api(), mailbox([broken, digital(1)]), 60) == 0

    assert [o["order_key"] for o in kasten.orders[0]] == ["D01-1234567-0000001"]
    assert "Skipped mail bad" in caplog.text
    assert "1 mails skipped" in caplog.text


def test_an_order_kasten_refuses_costs_only_that_order() -> None:
    kasten = FakeKasten(accounts=[], refuse_orders={"D01-1234567-0000002"})

    assert order_sync.sync(kasten.api(), mailbox([digital(1), digital(2), digital(3)]), 60) == 0

    sent = [o["order_key"] for batch in kasten.orders for o in batch]
    assert sent == ["D01-1234567-0000001", "D01-1234567-0000003"]


def test_the_run_fails_only_when_kasten_took_none_of_the_orders() -> None:
    kasten = FakeKasten(accounts=[], refuse_orders={"D01-1234567-0000001"})

    assert order_sync.sync(kasten.api(), mailbox([digital(1)]), 60) == 1
    assert order_sync.sync(kasten.api(), mailbox([]), 60) == 0


def test_a_paypal_payment_to_amazon_stays_a_paypal_order() -> None:
    to_amazon = SHOP_PAYMENT.replace("Example Shop GmbH", "Amazon Payments Europe S.C.A.")

    [order] = order_sync.gather(mailbox([paypal_mail("pay", to_amazon)]), 60)

    assert (order["source"], order["merchant"]) == ("paypal", "Amazon Payments Europe S.C.A.")


def test_a_merchant_name_is_cut_to_what_kasten_takes() -> None:
    long = SHOP_PAYMENT.replace("Example Shop GmbH", "S" * 600)

    [order] = order_sync.gather(mailbox([paypal_mail("pay", long)]), 60)

    assert len(order["merchant"]) == order_sync.TEXT
