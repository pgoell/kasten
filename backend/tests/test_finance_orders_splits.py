"""What an order's split does to its booking: discounts, the booking's rule category, undo, caps.

Through the routes, on a migrated database, as `test_finance_orders.py`.
"""

from decimal import Decimal
from typing import TYPE_CHECKING

from backend.tests.finance_order_rows import (
    ORDERS,
    amazon,
    amazon_booking,
    charge,
    item,
    parts,
    paypal,
    paypal_booking,
    send,
)
from backend.tests.finance_rows import API, GIRO, account, category, post, rule, stored
from kasten_backend.finance_order_models import OrderItem
from kasten_backend.finance_order_text import same_shop, shop_name
from kasten_backend.finance_orders import net

if TYPE_CHECKING:
    from httpx import AsyncClient


async def test_a_discount_is_shared_out_so_the_budget_counts_what_was_paid(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    books, home = await category(finance_client, "Books"), await category(finance_client, "Home")
    await rule(finance_client, "text_contains", "book", books)
    await rule(finance_client, "text_contains", "mug", home)
    await post(finance_client, [paypal_booking(giro, "pp", "-25.00")])
    discounted = paypal(
        total="25.00",
        charges=[
            charge(
                "payment",
                "25.00",
                [item("Garden book", "20.00"), item("Blue mug", "10.00"), item("Rabatt", "-5.00")],
            )
        ],
    )

    await send(finance_client, [discounted])

    row = (await stored(finance_client))["pp"]
    assert parts(row) == [("-16.67", "Garden book"), ("-8.33", "Blue mug")]
    drill = (await finance_client.get(f"{API}/drill/bookings/{row['id']}")).json()
    counted = sum(Decimal(c["amount"]) for c in drill["counts"])
    assert counted == Decimal("25.00")


def test_net_shares_a_credit_by_amount_and_keeps_every_cent() -> None:
    def items(*amounts: str) -> list[OrderItem]:
        return [OrderItem(text=f"i{n}", amount=Decimal(a)) for n, a in enumerate(amounts)]

    assert net(items("10.00", "10.00", "10.00", "-1.00")) == [
        ("i0", Decimal("9.67")),
        ("i1", Decimal("9.67")),
        ("i2", Decimal("9.66")),
    ]
    assert net(items("0.01", "99.99", "-50.00")) == [
        ("i1", Decimal("50.00")),
    ]
    assert net(items("4.50", "0.00")) == [("i0", Decimal("4.50"))]


async def test_a_part_no_rule_names_keeps_the_category_a_purpose_rule_gave_the_booking(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    shopping, home = (
        await category(finance_client, "Shopping"),
        await category(finance_client, "Home"),
    )
    await rule(finance_client, "text_contains", "amznmktp", shopping)
    await rule(finance_client, "text_contains", "lamp", home)
    await post(
        finance_client,
        [
            amazon_booking(giro, "a", "-25.00", "2026-10-17"),
            amazon_booking(giro, "b", "-15.00", "2026-10-20"),
        ],
    )
    assert (await stored(finance_client))["b"]["category_id"] == shopping

    await send(finance_client, [amazon()])

    rows = await stored(finance_client)
    assert [(s["text"], s["category_id"]) for s in rows["a"]["splits"]] == [("Lamp", home)]
    assert [s["category_id"] for s in rows["b"]["splits"]] == [shopping, shopping]


async def test_splits_taken_away_by_hand_stay_away_and_say_so(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [paypal_booking(giro, "pp")])
    await send(finance_client, [paypal()])
    booking_id = (await stored(finance_client))["pp"]["id"]

    put = await finance_client.put(f"{API}/transactions/{booking_id}/splits", json=[])
    assert put.status_code == 200, put.text
    await send(finance_client, [paypal()])
    await post(finance_client, [])

    assert (await stored(finance_client))["pp"]["splits"] == []
    drill = (await finance_client.get(f"{API}/drill/bookings/{booking_id}")).json()
    assert drill["order"]["order"]["charges"][0]["status"] == "unsplit"


async def test_splits_rewritten_by_hand_read_as_kept(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [paypal_booking(giro, "pp")])
    await send(finance_client, [paypal()])
    booking_id = (await stored(finance_client))["pp"]["id"]

    mine = [{"amount": "-30.00", "text": "all mine"}]
    await finance_client.put(f"{API}/transactions/{booking_id}/splits", json=mine)

    drill = (await finance_client.get(f"{API}/drill/bookings/{booking_id}")).json()
    assert drill["order"]["order"]["charges"][0]["status"] == "kept"


async def test_too_many_items_or_too_long_a_text_is_refused(finance_client: AsyncClient) -> None:
    many = paypal(charges=[charge("payment", "101.00", [item("x", "1.00")] * 101)])
    long = paypal(charges=[charge("payment", "30.00", [item("x" * 501, "30.00")])])

    for body in (many, long, paypal(order_key="k" * 201)):
        assert (await finance_client.post(ORDERS, json=[body])).status_code == 422


def test_shops_are_one_when_one_name_starts_the_other_and_short_names_match_whole() -> None:
    assert same_shop("Apple", "Apple Services")
    assert same_shop("Google Payment Irela...", "Google Payment Ireland Limited")
    assert not same_shop("Otto GmbH", "Lotto24 AG")
    assert not same_shop("C&A", "Carl Zeiss")
    assert same_shop("dm", "DM")


async def test_an_item_rule_beats_the_rule_on_the_booking_purpose(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    shopping, books = (
        await category(finance_client, "Shopping"),
        await category(finance_client, "Books"),
    )
    await rule(finance_client, "text_contains", "amznmktp", shopping)
    await rule(finance_client, "text_contains", "roman", books)
    await post(finance_client, [amazon_booking(giro, "b", "-15.00", "2026-10-20")])
    order = amazon(
        charges=[
            charge(
                "ship-b",
                "15.00",
                [item("Roman Taschenbuch", "12.00"), item("Lamp shade", "3.00")],
                day="2026-10-18",
            )
        ]
    )

    await send(finance_client, [order])

    splits = (await stored(finance_client))["b"]["splits"]
    assert [(s["text"], s["category_id"]) for s in splits] == [
        ("Roman Taschenbuch", books),
        ("Lamp shade", shopping),
    ]


def test_shop_names_compare_without_legal_forms_spaces_or_dots() -> None:
    assert shop_name("Takeaway.com Payments B.V.") == shop_name("Takeaway.comPayments B.V.")
    assert shop_name("Hetzner Online GmbH FOLGELASTSCHRIFT") == "hetzneronline"
    assert shop_name(" , ") == ""


async def test_a_paypal_debit_matches_by_the_shop_name_after_ihr_einkauf_bei(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    legal = (
        "1059876543212/PP.4711.PP/. Example Holding B.V., Ihr Einkauf bei Example Shop"
        " FOLGELASTSCHRIFT"
    )
    await post(finance_client, [paypal_booking(giro, "pp", purpose=legal)])

    await send(finance_client, [paypal(merchant="Example Shop")])

    assert len((await stored(finance_client))["pp"]["splits"]) == 2


async def test_a_booking_in_no_paypal_debit_shape_or_an_amazon_one_without_the_id_never_matches(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            paypal_booking(giro, "card", purpose="PAYPAL *OTHERSTORE 4029357733"),
            amazon_booking(giro, "plain", "-25.00", "2026-10-17", "AMZNMktp DE 2X3Y4Z"),
        ],
    )

    answer = await send(finance_client, [paypal(), amazon()])

    assert answer["matched"] == 0
    assert all(row["splits"] == [] for row in (await stored(finance_client)).values())
