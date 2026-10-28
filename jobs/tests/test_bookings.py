"""The source key of a bank record: a move between own accounts takes the transfer key."""

from datetime import date
from decimal import Decimal
from pathlib import Path  # noqa: TC003  pytest's tmp_path annotation

from kasten_jobs.bookings import to_bookings, transfer_prefix

from .fake_fints import GIRO, SAVING, FakeClient, record  # noqa: TID252
from .fake_kasten import FakeKasten, account  # noqa: TID252
from .test_bank_sync import run  # noqa: TID252

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


def _glued(name: str, amount: str = "1000.00"):
    """A record shaped as DKB sends an incoming transfer to a savings account."""
    made = record(amount, "Umbuchung").data
    made.update(applicant_iban=None, gvc_applicant_iban=None, applicant_name=name)
    return made


def test_an_own_iban_glued_to_the_name_takes_the_transfer_key() -> None:
    [move] = to_bookings(
        "dkb", SAVING, 2, [_glued(f"{GIRO}Pascal Gollner")], frozenset({GIRO, SAVING})
    )

    lo, hi = sorted((GIRO, SAVING))
    assert move["source_key"] == f"transfer:{lo}:{hi}:2026-10-20:1000.00:0"
    assert move["counterparty_iban"] == GIRO
    assert move["counterparty_name"] == "Pascal Gollner"
    assert move["raw"]["applicant_name"] == f"{GIRO}Pascal Gollner"


def test_a_strangers_iban_glued_to_the_name_is_split_but_keeps_the_bank_key() -> None:
    plain = to_bookings("dkb", SAVING, 2, [_glued("Pascal Gollner")], frozenset({GIRO, SAVING}))
    [payment] = to_bookings(
        "dkb", SAVING, 2, [_glued(f"{STRANGER} Bäckerei Müller ")], frozenset({GIRO, SAVING})
    )

    assert payment["source_key"] == plain[0]["source_key"]
    assert payment["source_key"].startswith(f"dkb:{SAVING}:2026-10-20:1000.00:9310:")
    assert payment["counterparty_iban"] == STRANGER
    assert payment["counterparty_name"] == "Bäckerei Müller"


def test_only_a_german_or_an_own_iban_is_cut_from_the_name() -> None:
    austrian = "AT611904300234573201"
    names = [
        "DEUTSCHE BAHN",
        f"{STRANGER}7 Ltd",
        "AT483200000012345864Wien Energie",
        f"{austrian}Pascal Gollner",
        STRANGER,
    ]

    bookings = to_bookings("dkb", SAVING, 2, [_glued(n) for n in names], frozenset({austrian}))

    assert [(b["counterparty_iban"], b["counterparty_name"]) for b in bookings] == [
        (None, "DEUTSCHE BAHN"),
        (None, f"{STRANGER}7 Ltd"),
        (None, "AT483200000012345864Wien Energie"),
        (austrian, "Pascal Gollner"),
        (STRANGER, None),
    ]


def test_the_sync_posts_the_own_iban_it_cut_from_the_name(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO), account(2, SAVING)])
    client = FakeClient({GIRO: [], SAVING: [record("1000.00")]})
    client.answers[SAVING][0].data.update(
        applicant_iban=None, applicant_name=f"{GIRO}Pascal Gollner"
    )

    run(kasten, client, tmp_path)

    [booking] = kasten.bookings
    assert booking["source_key"].startswith("transfer:")
    assert booking["counterparty_iban"] == GIRO
