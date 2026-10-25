"""Transfer linking after a batch: which two bookings make one move between own accounts.

Through `POST /api/finance/transactions`, which links after every insert. Each
test needs a migrated database and skips without one.
"""

from typing import TYPE_CHECKING

from backend.tests.finance_rows import GIRO, SAVING, STRANGER, account, booking, groups, post

if TYPE_CHECKING:
    from httpx import AsyncClient


async def test_a_move_between_own_accounts_is_paired_once_and_a_lookalike_is_not(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", iban=GIRO)
    saving = await account(finance_client, "Saving", iban=SAVING)
    out = booking(giro, "out", amount="-100.00", counterparty_iban=SAVING)
    # The same amount to someone else, the same day: no twin of anything.
    lookalike = booking(giro, "rent", amount="-100.00", counterparty_iban=STRANGER)
    # Booked on the other side two days later, as an ordinary transfer is.
    into = booking(saving, "in", amount="100.00", booking_date="2026-10-22", counterparty_iban=GIRO)

    # The halves in two posts, as two pulls would send them.
    assert (await post(finance_client, [out, lookalike]))["linked"] == 0
    assert (await post(finance_client, [into]))["linked"] == 1
    assert (await post(finance_client, [out, lookalike, into]))["linked"] == 0

    found = await groups(finance_client)
    assert found["out"] is not None
    assert found["out"] == found["in"]
    assert found["rent"] is None


async def test_five_days_apart_pair_and_six_do_not(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", iban=GIRO)
    saving = await account(finance_client, "Saving", iban=SAVING)

    linked = await post(
        finance_client,
        [
            booking(giro, "out5", amount="-50.00", counterparty_iban=SAVING),
            booking(saving, "in5", amount="50.00", booking_date="2026-10-25"),
            booking(giro, "out6", amount="-60.00", counterparty_iban=SAVING),
            booking(saving, "in6", amount="60.00", booking_date="2026-10-26"),
        ],
    )

    assert linked["linked"] == 1
    found = await groups(finance_client)
    assert found["out5"] == found["in5"] is not None
    assert found["out6"] is found["in6"] is None


async def test_an_incoming_booking_from_a_stranger_is_no_twin(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", iban=GIRO)
    saving = await account(finance_client, "Saving", iban=SAVING)

    # A gift into the saving account the day the giro sends the same amount there.
    linked = await post(
        finance_client,
        [
            booking(saving, "gift", amount="100.00", counterparty_iban=STRANGER),
            booking(giro, "out", amount="-100.00", counterparty_iban=SAVING),
        ],
    )

    assert linked["linked"] == 0


async def test_another_currency_is_no_twin(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", iban=GIRO)
    saving = await account(finance_client, "Saving", iban=SAVING)

    linked = await post(
        finance_client,
        [
            booking(giro, "out", amount="-5.00", counterparty_iban=SAVING),
            booking(saving, "in", amount="5.00", currency="USD"),
        ],
    )

    assert linked["linked"] == 0


async def test_two_equal_moves_on_one_day_make_two_pairs(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", iban=GIRO)
    saving = await account(finance_client, "Saving", iban=SAVING)

    linked = await post(
        finance_client,
        [
            booking(giro, "out0", amount="-20.00", counterparty_iban=SAVING),
            booking(giro, "out1", amount="-20.00", counterparty_iban=SAVING),
            booking(saving, "in0", amount="20.00", counterparty_iban=GIRO),
            booking(saving, "in1", amount="20.00", counterparty_iban=GIRO),
        ],
    )

    assert linked["linked"] == 2
    found = await groups(finance_client)
    assert None not in found.values()
    assert len(set(found.values())) == 2


async def test_an_iban_written_in_groups_still_links(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", iban="de02 1203 0000 0000 2020 51")
    saving = await account(finance_client, "Saving", iban=SAVING)

    linked = await post(
        finance_client,
        [
            booking(giro, "out", amount="-5.00", counterparty_iban=SAVING.lower()),
            booking(saving, "in", amount="5.00", counterparty_iban=GIRO),
        ],
    )

    assert linked["linked"] == 1
