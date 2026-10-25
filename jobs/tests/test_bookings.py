"""The source key of a bank record: a move between own accounts takes the transfer key."""

from datetime import date
from decimal import Decimal
from pathlib import Path  # noqa: TC003  pytest's tmp_path annotation

from kasten_jobs.bookings import to_bookings, transfer_prefix

from .fake_fints import GIRO, SAVING, FakeClient, record
from .fake_kasten import FakeKasten, account
from .test_bank_sync import run

STRANGER = "DE89370400440532013000"


def _to(iban: str, amount: str = "-500.00"):
    made = record(amount, "Umbuchung")
    made.data["applicant_iban"] = iban
    return made.data


def test_a_record_to_an_own_account_takes_the_transfer_key() -> None:
    own = frozenset({GIRO, SAVING})
    spaced = " ".join(SAVING[i : i + 4] for i in range(0, len(SAVING), 4)).lower()

    [move, again, payment] = to_bookings(
        "dkb", GIRO, 1, [_to(SAVING), _to(spaced), _to(STRANGER)], own
    )

    lo, hi = sorted((GIRO, SAVING))
    assert move["source_key"] == f"transfer:{lo}:{hi}:2026-10-20:500.00:0"
    assert again["source_key"] == f"transfer:{lo}:{hi}:2026-10-20:500.00:1"
    assert payment["source_key"].startswith(f"dkb:{GIRO}:2026-10-20:-500.00:9310:")


def test_both_halves_and_every_spelling_of_the_amount_share_one_prefix() -> None:
    day = date(2026, 10, 20)
    giro_side = transfer_prefix(GIRO, SAVING, day, Decimal(-500))
    saving_side = transfer_prefix(SAVING, GIRO, day, Decimal("500.000000000000"))

    assert giro_side == saving_side


def test_the_sync_keys_a_move_between_two_kasten_accounts_as_a_transfer(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO), account(2, SAVING)])
    client = FakeClient({GIRO: [record("-500.00")], SAVING: []})
    client.answers[GIRO][0].data["applicant_iban"] = SAVING

    run(kasten, client, tmp_path)

    [booking] = kasten.bookings
    assert booking["source_key"].startswith("transfer:")
