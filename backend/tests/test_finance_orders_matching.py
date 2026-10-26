"""How a PayPal or Amazon charge picks its booking by the text the bank writes.

Amazon's debits start with the order id; PayPal's name the shop. Through the
routes, on a migrated database, as `test_finance_orders.py`.
"""

from typing import TYPE_CHECKING

from backend.tests.finance_order_rows import (
    PAYPAL_PURPOSE,
    amazon,
    amazon_booking,
    amazon_purpose,
    charge,
    item,
    parts,
    paypal,
    paypal_booking,
    send,
    statuses,
    unmatched,
)
from backend.tests.finance_rows import GIRO, SAVING, account, booking, post, stored
from kasten_backend.finance_order_text import Candidate, choose

if TYPE_CHECKING:
    from httpx import AsyncClient


async def test_two_bookings_that_fit_alike_leave_the_charge_ambiguous(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            paypal_booking(giro, "one"),
            paypal_booking(giro, "two", booking_date="2026-10-20"),
        ],
    )

    answer = await send(finance_client, [paypal()])

    rows = await stored(finance_client)
    assert answer["matched"] == 0
    assert rows["one"]["splits"] == rows["two"]["splits"] == []
    assert statuses(await unmatched(finance_client)) == {"payment": "ambiguous"}


async def test_the_booking_naming_the_order_id_wins_over_one_that_does_not(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            amazon_booking(giro, "other", "-25.00", "2026-10-16", "AMZNMktp DE 2X3Y4Z"),
            amazon_booking(giro, "named", "-25.00", "2026-10-19", amazon_purpose()),
        ],
    )

    await send(finance_client, [amazon()])

    rows = await stored(finance_client)
    assert parts(rows["named"]) == [("-25.00", "Lamp")]
    assert rows["other"]["splits"] == []


async def test_an_older_charge_leaves_a_booking_naming_another_order_to_that_order(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            amazon_booking(
                giro, "named", "-25.00", "2026-10-19", amazon_purpose("999-0000000-0000001")
            )
        ],
    )
    older = amazon(charges=[charge("old", "25.00", [item("Old lamp", "25.00")], day="2026-10-15")])
    newer = amazon(
        "999-0000000-0000001",
        charges=[charge("new", "25.00", [item("New lamp", "25.00")], day="2026-10-18")],
    )

    await send(finance_client, [older, newer])

    assert parts((await stored(finance_client))["named"]) == [("-25.00", "New lamp")]
    assert statuses(await unmatched(finance_client)) == {"old": "waiting"}


async def test_a_move_between_own_accounts_and_a_booking_out_of_window_never_match(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await account(finance_client, "Saving", SAVING)
    await post(
        finance_client,
        [
            paypal_booking(giro, "move", counterparty_iban=SAVING),
            paypal_booking(giro, "late", booking_date="2026-11-05"),
            booking(giro, "rewe", "-30.00", booking_date="2026-10-18", purpose="REWE"),
        ],
    )

    answer = await send(finance_client, [paypal()])

    assert answer["matched"] == 0
    assert all(row["splits"] == [] for row in (await stored(finance_client)).values())
    assert statuses(await unmatched(finance_client)) == {"payment": "waiting"}


async def test_a_booking_pays_one_charge_only(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [paypal_booking(giro, "pp")])

    answer = await send(finance_client, [paypal("1AB23456CD789012E"), paypal("9ZZ99999ZZ999999Z")])

    assert answer["matched"] == 1
    assert statuses(await unmatched(finance_client)) == {"payment": "waiting"}
    assert [o["order_key"] for o in await unmatched(finance_client)] == ["9ZZ99999ZZ999999Z"]


def test_choose_takes_the_best_ranked_booking_and_never_guesses_between_two() -> None:
    assert choose([]) == ("waiting", None)
    assert choose([Candidate(1, 0), Candidate(2, 2)]) == ("linked", 2)
    assert choose([Candidate(1, 1), Candidate(2, 1), Candidate(3, 0)]) == ("ambiguous", None)
    # Two that name the order id are two shipments of one amount: the older is taken.
    assert choose([Candidate(4, 2), Candidate(5, 2)]) == ("linked", 4)
    assert choose([Candidate(6, -1)]) == ("waiting", None)


async def test_two_shipments_of_one_amount_each_take_one_booking_naming_the_order(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            amazon_booking(
                giro, "a", "-9.99", "2026-10-17", amazon_purpose(ref="1AAAAAAAAAAAAAAA")
            ),
            amazon_booking(
                giro, "b", "-9.99", "2026-10-17", amazon_purpose(ref="2BBBBBBBBBBBBBBB")
            ),
        ],
    )
    twice = amazon(
        charges=[
            charge("ship-a", "9.99", [item("Seeds", "9.99")], day="2026-10-16"),
            charge("ship-b", "9.99", [item("Pots", "9.99")], day="2026-10-16"),
        ]
    )

    assert (await send(finance_client, [twice]))["matched"] == 2

    rows = await stored(finance_client)
    assert sorted(parts(rows["a"]) + parts(rows["b"])) == [("-9.99", "Pots"), ("-9.99", "Seeds")]


async def test_a_digital_order_matches_its_prime_video_debit_named_by_its_id(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    digital = "D01-7654321-1234567"
    await post(
        finance_client,
        [
            booking(
                giro,
                "pv",
                "-16.99",
                booking_date="2026-10-21",
                purpose=f"{digital} Prime Video Channels 3CDE4FGH5IJK6LMN FOLGELASTSCHRIFT",
                counterparty_name="AMAZON DIGITAL GERMANY GMBH",
            )
        ],
    )
    order = amazon(
        digital,
        ordered_on="2026-10-20",
        total="16.99",
        charges=[charge("order", "16.99", [item("A channel", "16.99")], day="2026-10-20")],
    )

    await send(finance_client, [order])

    assert parts((await stored(finance_client))["pv"]) == [("-16.99", "A channel")]


async def test_a_late_booking_matches_only_when_it_names_the_order(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            amazon_booking(giro, "named", "-25.00", "2026-11-05"),
            amazon_booking(giro, "plain", "-15.00", "2026-11-05", "AMZNMktp DE 2X3Y4Z"),
        ],
    )

    await send(finance_client, [amazon()])

    rows = await stored(finance_client)
    assert parts(rows["named"]) == [("-25.00", "Lamp")]
    assert rows["plain"]["splits"] == []


async def test_a_paypal_debit_naming_the_shop_wins_and_one_naming_another_shop_never_matches(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    other = PAYPAL_PURPOSE.replace("Example Shop GmbH", "Other Store AG")
    blank = "1059876543211/PP.4711.PP/. , Ihr Einkauf bei FOLGELASTSCHRIFT"
    await post(
        finance_client,
        [
            paypal_booking(giro, "other", purpose=other),
            paypal_booking(giro, "blank", booking_date="2026-10-20", purpose=blank),
            paypal_booking(giro, "shop", booking_date="2026-10-21"),
        ],
    )

    await send(finance_client, [paypal()])

    rows = await stored(finance_client)
    assert len(rows["shop"]["splits"]) == 2
    assert rows["other"]["splits"] == rows["blank"]["splits"] == []


async def test_money_sent_to_a_person_matches_a_debit_that_names_no_shop(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    blank = "1059876543211/PP.4711.PP/. , Ihr Einkauf bei FOLGELASTSCHRIFT"
    other = PAYPAL_PURPOSE.replace("Example Shop GmbH", "Other Store AG")
    await post(
        finance_client,
        [
            paypal_booking(giro, "blank", "-55.00", purpose=blank),
            paypal_booking(giro, "other", "-55.00", booking_date="2026-10-18", purpose=other),
        ],
    )
    sent = paypal(
        "5EF67890GH123456J",
        merchant="Sam Sample",
        total="55.00",
        charges=[charge("payment", "55.00", [item("Sam Sample", "55.00")])],
    )

    await send(finance_client, [sent])

    rows = await stored(finance_client)
    assert parts(rows["blank"]) == [("-55.00", "Sam Sample")]
    assert rows["other"]["splits"] == []


async def test_an_amazon_order_paid_with_paypal_is_matched_by_the_paypal_order_alone(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    shop = "Amazon Payments Europe S.C.A."
    purpose = PAYPAL_PURPOSE.replace("Example Shop GmbH", shop)
    await post(finance_client, [paypal_booking(giro, "pp", "-25.00", purpose=purpose)])
    via_paypal = paypal(
        merchant=shop,
        total="25.00",
        charges=[charge("payment", "25.00", [item(shop, "25.00")])],
    )

    await send(finance_client, [amazon(), via_paypal])

    assert parts((await stored(finance_client))["pp"]) == [("-25.00", shop)]
    assert statuses(await unmatched(finance_client)) == {"ship-a": "waiting", "ship-b": "waiting"}
