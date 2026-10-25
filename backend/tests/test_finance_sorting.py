"""Sorting bookings: payees from counterparties, rule precedence, the hand, re-runs, to-sort.

Every test goes through the routes, on a migrated database, and skips
without one; see the `finance_session` fixture.
"""

from typing import TYPE_CHECKING, Any

from backend.tests.finance_rows import account, booking, post

if TYPE_CHECKING:
    from httpx import AsyncClient

API = "/api/finance"


async def category(client: AsyncClient, name: str, kind: str = "flexible") -> int:
    response = await client.post(f"{API}/categories", json={"name": name, "kind": kind})
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def rule(client: AsyncClient, kind: str, pattern: str, category_id: int) -> int:
    response = await client.post(
        f"{API}/rules", json={"kind": kind, "pattern": pattern, "category_id": category_id}
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def stored(client: AsyncClient) -> dict[str, dict[str, Any]]:
    """Every booking by source key."""
    rows = (await client.get(f"{API}/transactions")).json()
    return {row["source_key"]: row for row in rows}


async def payee_of(client: AsyncClient, key: str) -> int:
    return (await stored(client))[key]["payee_id"]


async def test_bookings_of_one_counterparty_however_spelled_share_one_payee(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    await post(
        finance_client,
        [
            booking(giro, "a", counterparty_name="Bäckerei  Müller GmbH."),
            booking(giro, "b", counterparty_name="BÄCKEREI MÜLLER GMBH"),
            booking(giro, "c", counterparty_name=" - "),
        ],
    )

    rows = await stored(finance_client)
    payees = (await finance_client.get(f"{API}/payees")).json()
    assert rows["a"]["payee_id"] == rows["b"]["payee_id"] is not None
    assert rows["c"]["payee_id"] is None
    assert [(p["key"], p["name"]) for p in payees] == [
        ("bäckerei müller gmbh", "Bäckerei Müller GmbH.")
    ]


async def test_a_text_rule_beats_the_payee_default_and_the_longest_pattern_wins(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    shopping, music, books, food = [
        await category(finance_client, name) for name in ("Shopping", "Music", "Books", "Food")
    ]
    await post(
        finance_client,
        [
            booking(giro, "spotify", purpose="PAYPAL Spotify AB", counterparty_name="PayPal"),
            booking(giro, "kindle", purpose="PAYPAL kindle book", counterparty_name="PayPal"),
            booking(giro, "plain", purpose="PAYPAL 123", counterparty_name="PayPal"),
            booking(giro, "rewe", purpose="", counterparty_name="REWE Markt 0815"),
        ],
    )
    await rule(finance_client, "text_contains", "spotify", music)
    await rule(finance_client, "text_contains", "book", books)
    await rule(finance_client, "text_contains", "kindle book", shopping)
    await rule(finance_client, "payee", "rewe", food)
    await rule(finance_client, "payee", "paypal", food)
    payee = await payee_of(finance_client, "plain")
    assert (
        await finance_client.put(f"{API}/payees/{payee}", json={"category_id": shopping})
    ).status_code == 200

    rows = await stored(finance_client)
    assert rows["spotify"]["category_id"] == music
    assert rows["kindle"]["category_id"] == shopping
    # The payee's own default comes before the payee rule that also names it.
    assert rows["plain"]["category_id"] == shopping
    assert rows["rewe"]["category_id"] == food
    assert {row["category_set_by"] for row in rows.values()} == {"rule"}
    order = [(r["kind"], r["pattern"]) for r in (await finance_client.get(f"{API}/rules")).json()]
    assert order == [
        ("text_contains", "kindle book"),
        ("text_contains", "spotify"),
        ("text_contains", "book"),
        ("payee", "paypal"),
        ("payee", "rewe"),
    ]


async def test_a_category_set_by_hand_outlives_every_rule_change_until_it_is_cleared(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    food, gifts = await category(finance_client, "Food"), await category(finance_client, "Gifts")
    await post(finance_client, [booking(giro, "k", purpose="REWE")])
    booking_id = (await stored(finance_client))["k"]["id"]

    hand = await finance_client.put(
        f"{API}/transactions/{booking_id}/category", json={"category_id": gifts}
    )
    await rule(finance_client, "text_contains", "rewe", food)
    run = await finance_client.post(f"{API}/rules/run")

    assert hand.json()["category_set_by"] == "hand"
    assert run.json() == {"changed": 0}
    assert (await stored(finance_client))["k"]["category_id"] == gifts

    cleared = await finance_client.put(
        f"{API}/transactions/{booking_id}/category", json={"category_id": None}
    )
    assert (cleared.json()["category_id"], cleared.json()["category_set_by"]) == (food, "rule")


async def test_a_re_run_takes_back_what_a_deleted_rule_gave(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro")
    food = await category(finance_client, "Food")
    await post(finance_client, [booking(giro, "k", purpose="REWE")])
    made = await rule(finance_client, "text_contains", "rewe", food)
    assert (await stored(finance_client))["k"]["category_id"] == food

    assert (await finance_client.delete(f"{API}/rules/{made}")).status_code == 204

    row = (await stored(finance_client))["k"]
    assert (row["category_id"], row["category_set_by"]) == (None, None)


async def test_ingest_sorts_new_bookings_and_leaves_transfers_out(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", "DE02120300000000202051")
    saving = await account(finance_client, "Saving", "DE02500105170137075030")
    food = await category(finance_client, "Food")
    await rule(finance_client, "text_contains", "rewe", food)

    await post(
        finance_client,
        [
            booking(giro, "rewe", purpose="REWE SAGT DANKE"),
            booking(
                giro,
                "out",
                "-50.00",
                purpose="rewe savings",
                counterparty_iban="DE02500105170137075030",
            ),
            booking(saving, "in", "50.00", purpose="rewe savings"),
        ],
    )

    rows = await stored(finance_client)
    assert rows["rewe"]["category_id"] == food
    assert rows["out"]["transfer_group"] is not None
    assert rows["out"]["category_id"] is None
    to_sort = (await finance_client.get(f"{API}/to-sort")).json()
    assert to_sort == []


async def test_to_sort_pages_oldest_first_and_shows_a_booking_by_its_loose_splits(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    books = await category(finance_client, "Books")
    await post(
        finance_client,
        [
            booking(giro, "late", booking_date="2026-10-22"),
            booking(giro, "early", booking_date="2026-10-01"),
            booking(giro, "order", "-30.00", booking_date="2026-10-10", purpose="AMAZON"),
        ],
    )
    await rule(finance_client, "text_contains", "novel", books)
    order = (await stored(finance_client))["order"]["id"]
    split = await finance_client.put(
        f"{API}/transactions/{order}/splits",
        json=[{"amount": "-20.00", "text": "A novel"}, {"amount": "-10.00", "text": "Cable"}],
    )
    assert [part["category_id"] for part in split.json()["splits"]] == [books, None]

    first = (await finance_client.get(f"{API}/to-sort", params={"limit": 2})).json()
    rest = (
        await finance_client.get(f"{API}/to-sort", params={"limit": 2, "after": first[-1]["id"]})
    ).json()

    assert [row["booking_date"] for row in first + rest] == [
        "2026-10-01",
        "2026-10-10",
        "2026-10-22",
    ]
    assert first[1]["splits"] == [
        {"id": split.json()["splits"][1]["id"], "amount": "-10.00", "text": "Cable"}
    ]
    assert first[0]["splits"] == []


async def test_a_split_by_hand_and_a_category_on_a_split_booking(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    cables = await category(finance_client, "Cables")
    await post(finance_client, [booking(giro, "order", "-30.00")])
    order = (await stored(finance_client))["order"]["id"]
    parts = (
        await finance_client.put(
            f"{API}/transactions/{order}/splits",
            json=[{"amount": "-20.00"}, {"amount": "-10.00"}],
        )
    ).json()["splits"]

    whole = await finance_client.put(
        f"{API}/transactions/{order}/category", json={"category_id": cables}
    )
    part = await finance_client.put(
        f"{API}/splits/{parts[1]['id']}/category", json={"category_id": cables}
    )
    missing = await finance_client.put(f"{API}/splits/0/category", json={"category_id": cables})
    unknown = await finance_client.put(
        f"{API}/splits/{parts[0]['id']}/category", json={"category_id": 0}
    )

    assert whole.status_code == 409
    assert (part.json()["category_id"], part.json()["category_set_by"]) == (cables, "hand")
    assert missing.status_code == 404
    assert unknown.status_code == 422


async def test_deleting_a_category_sends_its_bookings_back_to_sort(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    food = await category(finance_client, "Food")
    await post(finance_client, [booking(giro, "k")])
    booking_id = (await stored(finance_client))["k"]["id"]
    await finance_client.put(
        f"{API}/transactions/{booking_id}/category", json={"category_id": food}
    )
    taken = await finance_client.post(f"{API}/categories", json={"name": "Food", "kind": "fixed"})

    assert (await finance_client.delete(f"{API}/categories/{food}")).status_code == 204

    assert taken.status_code == 409
    assert [row["id"] for row in (await finance_client.get(f"{API}/to-sort")).json()] == [
        booking_id
    ]


async def test_a_repeated_rule_is_a_409_and_one_on_no_category_a_422(
    finance_client: AsyncClient,
) -> None:
    food = await category(finance_client, "Food")
    await rule(finance_client, "payee", "rewe", food)

    again = await finance_client.post(
        f"{API}/rules", json={"kind": "payee", "pattern": "rewe", "category_id": food}
    )
    nowhere = await finance_client.post(
        f"{API}/rules", json={"kind": "payee", "pattern": "edeka", "category_id": 0}
    )

    assert again.status_code == 409
    assert nowhere.status_code == 422


async def test_a_pattern_without_a_letter_or_digit_is_refused(finance_client: AsyncClient) -> None:
    food = await category(finance_client, "Food")

    dash = await finance_client.post(
        f"{API}/rules", json={"kind": "payee", "pattern": " - ", "category_id": food}
    )

    assert dash.status_code == 422
