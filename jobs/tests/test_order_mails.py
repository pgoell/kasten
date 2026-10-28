"""The order mail parsers on made-up mails in Amazon's and PayPal's shapes."""

from datetime import date
from decimal import Decimal

from kasten_jobs import orders_amazon, orders_paypal
from kasten_jobs.mail_text import german_date, html_lines

from .order_mails import (  # noqa: TID252
    CONFIRMATION,
    DAY,
    DIGITAL,
    DISPATCH,
    IN_DOLLARS,
    REFUND,
    SENT_TO_A_PERSON,
    SHOP_PAYMENT,
    TABLE_RECEIPT,
    TWO_ORDERS,
    amazon_mail,
    paypal_mail,
)


def test_a_confirmation_gives_the_order_its_day_and_total_and_no_charge() -> None:
    mail = amazon_mail("m1", orders_amazon.CONFIRMATION, CONFIRMATION)

    assert orders_amazon.parse_confirmation(mail) == [
        orders_amazon.Confirmation("111-2223334-4445556", DAY, Decimal("40.00"), None)
    ]


def test_a_confirmation_naming_two_orders_gives_neither_the_total() -> None:
    mail = amazon_mail("m1", orders_amazon.CONFIRMATION, TWO_ORDERS)

    orders = orders_amazon.parse_confirmation(mail)

    assert [(o.order_id, o.total) for o in orders] == [
        ("111-2223334-4445556", None),
        ("111-9999999-0000001", None),
    ]


def test_a_digital_order_is_its_own_charge_at_its_total_with_tax() -> None:
    mail = amazon_mail("m1", orders_amazon.CONFIRMATION, DIGITAL)

    assert orders_amazon.parse_confirmation(mail) == [
        orders_amazon.Confirmation(
            "D01-1234567-7654321",
            DAY,
            Decimal("8.99"),
            [("A Novel About Gardens (English Edition)", Decimal("8.99"))],
        )
    ]


def test_a_dispatch_charges_its_items_at_quantity_times_unit_price_to_the_cent() -> None:
    mail = amazon_mail("ship-1", orders_amazon.DISPATCH, DISPATCH)

    shipment = orders_amazon.parse_shipment(mail)

    assert shipment == orders_amazon.Shipment(
        "ship-1",
        "111-2223334-4445556",
        DAY,
        Decimal("27.00"),
        [
            ("Garden hose, 20 m, green", Decimal("24.50")),
            ("2 x Hose clip", Decimal("2.50")),
        ],
    )
    assert sum(amount for _, amount in shipment.items) == shipment.amount


def test_a_dispatch_naming_two_orders_or_no_items_is_skipped() -> None:
    two = DISPATCH.replace("Track package", "Order #\n111-9999999-0000001\nTrack package")
    bare = DISPATCH.split("* Garden")[0]

    for text in (two, bare):
        assert orders_amazon.parse_shipment(amazon_mail("s", orders_amazon.DISPATCH, text)) is None


def test_a_shop_payment_lists_its_items_and_shipping() -> None:
    payment = orders_paypal.parse_payment(paypal_mail("p1", SHOP_PAYMENT))

    assert payment == orders_paypal.Payment(
        "1AB23456CD789012E",
        DAY,
        "Example Shop GmbH",
        Decimal("36.40"),
        [
            ("Gartenschere", Decimal("19.90")),
            ("Handschuhe", Decimal("12.00")),
            ("Versand", Decimal("4.50")),
        ],
    )


def test_a_receipt_with_a_table_takes_its_rows_and_its_tax_and_skips_the_zero_lines() -> None:
    payment = orders_paypal.parse_payment(paypal_mail("p2", TABLE_RECEIPT))

    assert payment is not None
    assert (payment.code, payment.merchant, payment.total) == (
        "2BC34567DE890123F",
        "Example Software Ltd",
        Decimal("20.00"),
    )
    assert payment.items == [
        ("Pro plan, one month", Decimal("16.81")),
        ("Umsatzsteuer", Decimal("3.19")),
    ]


def test_money_sent_to_a_person_is_one_line_in_their_name() -> None:
    payment = orders_paypal.parse_payment(paypal_mail("p3", SENT_TO_A_PERSON))

    assert payment == orders_paypal.Payment(
        "3CD45678EF901234G", DAY, "Sam Sample", Decimal("25.00"), [("Sam Sample", Decimal("25.00"))]
    )


def test_lines_that_do_not_add_up_become_one_line_for_the_whole() -> None:
    short = SHOP_PAYMENT.replace("<span>Versand</span>", "<span>Hinweis</span>").replace(
        "4,50 €", "kostenlos"
    )

    payment = orders_paypal.parse_payment(paypal_mail("p4", short))

    assert payment is not None
    assert payment.items == [("Example Shop GmbH", Decimal("36.40"))]


def test_a_payment_in_another_currency_and_a_mail_with_no_code_are_skipped() -> None:
    assert orders_paypal.parse_payment(paypal_mail("p5", IN_DOLLARS)) is None
    assert orders_paypal.parse_payment(paypal_mail("p6", REFUND)) is None


def test_a_refund_names_the_day_and_amount_of_the_payment_it_refunds() -> None:
    assert orders_paypal.parse_refund(paypal_mail("r1", REFUND)) == orders_paypal.Refund(
        "r1", DAY, Decimal("11.50"), "Example Shop GmbH", date(2026, 10, 20), Decimal("36.40")
    )
    assert orders_paypal.parse_refund(paypal_mail("p1", SHOP_PAYMENT)) is None


def test_html_becomes_the_lines_a_reader_sees_without_styles() -> None:
    lines = html_lines("<head><style>p{}</style></head><p>Sie <b>haben</b>\n 1&nbsp;€</p><p></p>")

    assert lines == ["Sie haben 1 €"]


def test_german_dates_in_both_spellings() -> None:
    assert german_date("am 9. Oktober 2026") == date(2026, 10, 9)
    assert german_date("17.10.2026") == date(2026, 10, 17)
    assert german_date("im Oktober") is None
