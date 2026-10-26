"""PayPal and Amazon orders: stored by id, matched to their bookings, split into their items.

Every test goes through the routes, on a migrated database, and skips
without one; see the `finance_session` fixture. The order ids, codes and
names are made up.
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any

from backend.tests.finance_rows import (
    API,
    GIRO,
    SAVING,
    account,
    booking,
    category,
    post,
    rule,
    stored,
)
from kasten_backend.finance_orders import Candidate, choose

if TYPE_CHECKING:
    from httpx import AsyncClient

ORDERS = f"{API}/orders"
PAYPAL_PURPOSE = "PP.4711.PP . Example Shop GmbH, Ihr Einkauf bei Example Shop GmbH"


def item(text: str, amount: str) -> dict[str, str]:
    return {"text": text, "amount": amount}


def charge(key: str, amount: str, items: list[dict[str, str]], day: str = "2026-10-17") -> dict:
    return {"kind": "charge", "key": key, "charged_on": day, "amount": amount, "items": items}


def refund(key: str, amount: str, day: str = "2026-10-22") -> dict[str, str]:
    return {"kind": "refund", "key": key, "charged_on": day, "amount": amount}


def paypal(code: str = "1AB23456CD789012E", **fields: Any) -> dict[str, Any]:
    """A PayPal payment of 30.00 at Example Shop for a book and a mug."""
    return {
        "source": "paypal",
        "order_key": code,
        "ordered_on": "2026-10-17",
        "merchant": "Example Shop GmbH",
        "total": "30.00",
        "charges": [
            charge("payment", "30.00", [item("Garden book", "18.50"), item("Blue mug", "11.50")])
        ],
        **fields,
    }


def amazon(order_id: str = "123-4567890-1234567", **fields: Any) -> dict[str, Any]:
    """An Amazon order of 40.00, sent in two shipments of 25.00 and 15.00."""
    return {
        "source": "amazon",
        "order_key": order_id,
        "ordered_on": "2026-10-15",
        "merchant": "Amazon",
        "total": "40.00",
        "charges": [
            charge("ship-a", "25.00", [item("Lamp", "25.00")], day="2026-10-16"),
            charge(
                "ship-b",
                "15.00",
                [item("2 x Light bulb", "12.00"), item("Cable", "3.00")],
                day="2026-10-18",
            ),
        ],
        **fields,
    }


def paypal_booking(giro: int, key: str, amount: str = "-30.00", **fields: Any) -> dict:
    return booking(
        giro,
        key,
        amount,
        **{
            "booking_date": "2026-10-19",
            "purpose": PAYPAL_PURPOSE,
            "counterparty_name": "PayPal Europe S.a.r.l. et Cie S.C.A",
            **fields,
        },
    )


def amazon_booking(giro: int, key: str, amount: str, day: str, purpose: str = "") -> dict:
    return booking(
        giro,
        key,
        amount,
        booking_date=day,
        purpose=purpose or "AMZN Mktp DE 2X3Y4Z",
        counterparty_name="AMAZON PAYMENTS EUROPE S.C.A.",
    )


async def send(client: AsyncClient, orders: list[dict[str, Any]]) -> dict[str, int]:
    response = await client.post(ORDERS, json=orders)
    assert response.status_code == 200, response.text
    return response.json()


async def unmatched(client: AsyncClient) -> list[dict[str, Any]]:
    response = await client.get(f"{ORDERS}/unmatched")
    assert response.status_code == 200, response.text
    return response.json()


def statuses(orders: list[dict[str, Any]]) -> dict[str, str]:
    return {c["key"]: c["status"] for o in orders for c in o["charges"]}


def parts(row: dict[str, Any]) -> list[tuple[str, str | None]]:
    return [(s["amount"], s["text"]) for s in row["splits"]]


async def test_a_paypal_payment_splits_its_booking_into_the_items_which_the_rules_sort(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    books = await category(finance_client, "Books")
    await rule(finance_client, "text_contains", "book", books)
    await post(finance_client, [paypal_booking(giro, "pp")])
    before = len(await stored(finance_client))

    answer = await send(finance_client, [paypal()])

    rows = await stored(finance_client)
    assert answer == {"created": 1, "updated": 0, "unchanged": 0, "matched": 1}
    # The booking stays the one transaction; its items are its splits.
    assert len(rows) == before
    assert parts(rows["pp"]) == [("-18.50", "Garden book"), ("-11.50", "Blue mug")]
    assert rows["pp"]["category_id"] is None
    # The book takes the rule's category; the mug waits in the to-sort list.
    assert [(s["category_id"], s["category_set_by"]) for s in rows["pp"]["splits"]] == [
        (books, "rule"),
        (None, None),
    ]
    to_sort = (await finance_client.get(f"{API}/to-sort")).json()
    assert [(b["id"], len(b["splits"])) for b in to_sort["bookings"]] == [(rows["pp"]["id"], 1)]
    assert to_sort["total"] == 1
    assert await unmatched(finance_client) == []


async def test_a_split_booking_counts_once_in_the_budget_and_shows_its_order(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    books, home = await category(finance_client, "Books"), await category(finance_client, "Home")
    await rule(finance_client, "text_contains", "book", books)
    await rule(finance_client, "text_contains", "mug", home)
    await post(finance_client, [paypal_booking(giro, "pp")])
    await send(finance_client, [paypal()])
    booking_id = (await stored(finance_client))["pp"]["id"]

    drill = (await finance_client.get(f"{API}/drill/bookings/{booking_id}")).json()

    counted = {c["category_id"]: Decimal(c["amount"]) for c in drill["counts"]}
    # Spending counts as a positive amount, the booking's 30.00 once, item by item.
    assert counted == {books: Decimal("18.50"), home: Decimal("11.50")}
    order = drill["order"]["order"]
    assert order["order_key"] == "1AB23456CD789012E"
    assert drill["order"]["charge_id"] == order["charges"][0]["id"]
    assert order["charges"][0]["status"] == "split"


async def test_an_order_sent_again_changes_nothing(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [paypal_booking(giro, "pp")])
    await send(finance_client, [paypal()])
    first = (await stored(finance_client))["pp"]["splits"]

    again = await send(finance_client, [paypal(), paypal()])

    assert again == {"created": 0, "updated": 0, "unchanged": 2, "matched": 0}
    # The same split rows, not new ones of the same amounts.
    assert (await stored(finance_client))["pp"]["splits"] == first


async def test_each_amazon_shipment_splits_the_booking_that_charged_it(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            amazon_booking(giro, "a", "-25.00", "2026-10-17"),
            amazon_booking(giro, "b", "-15.00", "2026-10-20"),
        ],
    )

    answer = await send(finance_client, [amazon()])

    rows = await stored(finance_client)
    assert answer["matched"] == 2
    assert parts(rows["a"]) == [("-25.00", "Lamp")]
    assert parts(rows["b"]) == [("-12.00", "2 x Light bulb"), ("-3.00", "Cable")]


async def test_a_charge_whose_items_do_not_add_up_is_never_matched_and_stays_visible(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    shopping = await category(finance_client, "Shopping")
    await rule(finance_client, "text_contains", "example shop", shopping)
    await post(finance_client, [paypal_booking(giro, "pp")])
    short = paypal(charges=[charge("payment", "30.00", [item("Garden book", "18.50")])])

    answer = await send(finance_client, [short])

    row = (await stored(finance_client))["pp"]
    assert answer["matched"] == 0
    assert row["splits"] == []
    assert (row["category_id"], row["category_set_by"]) == (shopping, "rule")
    assert statuses(await unmatched(finance_client)) == {"payment": "items_off"}


async def test_a_booking_sorted_by_hand_is_linked_but_kept_as_it_is(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    gifts = await category(finance_client, "Gifts")
    await post(finance_client, [paypal_booking(giro, "pp")])
    booking_id = (await stored(finance_client))["pp"]["id"]
    put = await finance_client.put(
        f"{API}/transactions/{booking_id}/category", json={"category_id": gifts}
    )
    assert put.status_code == 200, put.text

    answer = await send(finance_client, [paypal()])

    row = (await stored(finance_client))["pp"]
    assert answer["matched"] == 1
    assert (row["category_id"], row["category_set_by"], row["splits"]) == (gifts, "hand", [])
    drill = (await finance_client.get(f"{API}/drill/bookings/{booking_id}")).json()
    assert drill["order"]["order"]["charges"][0]["status"] == "kept"
    assert await unmatched(finance_client) == []


async def test_a_booking_split_by_hand_keeps_its_splits(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [paypal_booking(giro, "pp")])
    booking_id = (await stored(finance_client))["pp"]["id"]
    mine = [{"amount": "-20.00", "text": "mine"}, {"amount": "-10.00", "text": "a gift"}]
    put = await finance_client.put(f"{API}/transactions/{booking_id}/splits", json=mine)
    assert put.status_code == 200, put.text

    await send(finance_client, [paypal()])

    assert parts((await stored(finance_client))["pp"]) == [
        ("-20.00", "mine"),
        ("-10.00", "a gift"),
    ]
    order = (await finance_client.get(f"{API}/drill/bookings/{booking_id}")).json()["order"]
    assert order["order"]["charges"][0]["status"] == "kept"


async def test_a_refund_links_its_own_booking_and_leaves_the_payment_split(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            paypal_booking(giro, "pp"),
            paypal_booking(giro, "back", "11.50", booking_date="2026-10-23"),
        ],
    )
    await send(finance_client, [paypal()])
    paid = (await stored(finance_client))["pp"]["splits"]

    answer = await send(
        finance_client, [paypal(charges=[*paypal()["charges"], refund("r1", "11.50")])]
    )

    rows = await stored(finance_client)
    assert (answer["updated"], answer["matched"]) == (1, 1)
    assert rows["back"]["splits"] == []
    assert rows["pp"]["splits"] == paid
    drill = (await finance_client.get(f"{API}/drill/bookings/{rows['back']['id']}")).json()
    charges = drill["order"]["order"]["charges"]
    assert {(c["kind"], c["status"], c["transaction_id"]) for c in charges} == {
        ("charge", "split", rows["pp"]["id"]),
        ("refund", "linked", rows["back"]["id"]),
    }


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
            amazon_booking(giro, "other", "-25.00", "2026-10-16"),
            amazon_booking(
                giro, "named", "-25.00", "2026-10-19", "123-4567890-1234567 AMZN Mktp DE"
            ),
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
        [amazon_booking(giro, "named", "-25.00", "2026-10-19", "999-0000000-0000001 AMZN")],
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


async def test_a_booking_that_comes_after_its_order_is_matched_when_it_comes_in(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await send(finance_client, [paypal()])
    assert statuses(await unmatched(finance_client)) == {"payment": "waiting"}

    await post(finance_client, [paypal_booking(giro, "pp")])

    assert parts((await stored(finance_client))["pp"]) == [
        ("-18.50", "Garden book"),
        ("-11.50", "Blue mug"),
    ]
    assert await unmatched(finance_client) == []


async def test_money_in_naming_an_amazon_order_becomes_its_refund(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(
        finance_client,
        [
            amazon_booking(giro, "a", "-25.00", "2026-10-17"),
            amazon_booking(giro, "b", "-15.00", "2026-10-20"),
            amazon_booking(giro, "back", "3.00", "2026-10-30", "Erstattung 123-4567890-1234567"),
        ],
    )

    await send(finance_client, [amazon()])
    again = await send(finance_client, [amazon()])

    rows = await stored(finance_client)
    assert again["unchanged"] == 1
    assert rows["back"]["splits"] == []
    drill = (await finance_client.get(f"{API}/drill/bookings/{rows['back']['id']}")).json()
    refunds = [c for c in drill["order"]["order"]["charges"] if c["kind"] == "refund"]
    assert [(c["amount"], c["status"]) for c in refunds] == [("3.00", "linked")]


async def test_a_waiting_charge_takes_a_new_send_and_a_matched_one_keeps_what_it_had(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", GIRO)
    await post(finance_client, [amazon_booking(giro, "a", "-25.00", "2026-10-17")])
    await send(finance_client, [amazon()])
    renamed = amazon()
    renamed["charges"][0]["items"] = [item("Desk lamp", "25.00")]
    renamed["charges"][1]["items"] = [item("Bulbs and cable", "15.00")]

    answer = await send(finance_client, [renamed])

    assert answer["updated"] == 1
    assert parts((await stored(finance_client))["a"]) == [("-25.00", "Lamp")]
    waiting = (await unmatched(finance_client))[0]["charges"][1]
    assert [i["text"] for i in waiting["items"]] == ["Bulbs and cable"]


async def test_a_send_without_the_confirmation_keeps_the_known_total_and_day(
    finance_client: AsyncClient,
) -> None:
    await send(finance_client, [amazon(charges=[])])

    answer = await send(finance_client, [amazon(charges=[], total=None, ordered_on="2026-10-18")])

    assert answer["unchanged"] == 1
    [order] = await unmatched(finance_client)
    assert (order["total"], order["ordered_on"]) == ("40.00", "2026-10-15")


async def test_an_amazon_order_with_no_shipment_yet_is_listed_as_unmatched(
    finance_client: AsyncClient,
) -> None:
    await send(finance_client, [amazon(charges=[])])

    assert [(o["order_key"], o["charges"]) for o in await unmatched(finance_client)] == [
        ("123-4567890-1234567", [])
    ]


async def test_a_charge_without_items_and_a_refund_with_items_are_refused(
    finance_client: AsyncClient,
) -> None:
    bare = paypal(charges=[charge("payment", "30.00", [])])
    itemised = paypal(charges=[{**refund("r", "5.00"), "items": [item("x", "5.00")]}])
    twice = paypal(charges=[*paypal()["charges"], *paypal()["charges"]])

    for body in (bare, itemised, twice, {**paypal(), "source": "ebay"}):
        response = await finance_client.post(ORDERS, json=[body])
        assert response.status_code == 422, body


def test_choose_takes_the_best_ranked_booking_and_never_guesses_between_two() -> None:
    assert choose([]) == ("waiting", None)
    assert choose([Candidate(1, 0), Candidate(2, 2)]) == ("linked", 2)
    assert choose([Candidate(1, 1), Candidate(2, 1), Candidate(3, 0)]) == ("ambiguous", None)
