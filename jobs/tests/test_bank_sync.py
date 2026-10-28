"""The bank sync against a fake FinTS client and a fake kasten: windows, TANs, CAMT, exit codes."""

import hashlib
import logging
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, cast

import pytest

from kasten_jobs import bank_sync, fints_bank
from kasten_jobs.bank_sync import Settings
from kasten_jobs.fints_bank import DECOUPLED_POLL_MAX, Bank

from .fake_fints import CAMT, GIRO, SAVING, FakeClient, Tan, record  # noqa: TID252
from .fake_kasten import FakeKasten, account  # noqa: TID252

if TYPE_CHECKING:
    from fints.client import FinTS3PinTanClient

TODAY = date(2026, 10, 25)
PIN = "geheim-4711"


def settings(tmp_path: Path) -> Settings:
    return Settings.from_env({"BANK_SYNC_STATE_DIR": str(tmp_path)})


def dkb(tmp_path: Path) -> Bank:
    return Bank("dkb", "12030000", "pascal", PIN, "https://fints.example/dkb", tmp_path / "dkb.bin")


class Clock:
    """A sleep that only counts."""

    def __init__(self) -> None:
        self.slept = 0.0

    def __call__(self, seconds: float) -> None:
        self.slept += seconds


def run(kasten: FakeKasten, client: FakeClient, tmp_path: Path, clock: Clock | None = None) -> int:
    return bank_sync.pull(
        kasten.api(),
        [dkb(tmp_path)],
        settings(tmp_path),
        "request",
        today=TODAY,
        make=lambda _bank, _state: cast("FinTS3PinTanClient", client),
        sleep=clock or Clock(),
    )


def test_a_window_starts_two_weeks_before_the_last_good_one_ended(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO, through="2026-10-20", newest="2026-10-19")])
    client = FakeClient({GIRO: [record("-4.20")]})

    assert run(kasten, client, tmp_path) == 0

    assert client.windows[GIRO] == (date(2026, 10, 6), TODAY)
    assert kasten.finishes == [
        {
            "outcome": "ok",
            "error": None,
            "accounts": [
                {
                    "account_id": 1,
                    "fetched_from": "2026-10-06",
                    "fetched_through": "2026-10-25",
                    "outcome": "ok",
                    "created": 1,
                    "skipped": 0,
                }
            ],
        }
    ]


def test_a_first_pull_starts_the_overlap_before_the_newest_booking_stored(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO, newest="2026-09-30"), account(2, SAVING)])
    client = FakeClient({GIRO: [], SAVING: []})

    run(kasten, client, tmp_path)

    assert client.windows[GIRO] == (date(2026, 9, 16), TODAY)
    assert client.windows[SAVING] == (date(2026, 7, 27), TODAY)


def test_the_overlap_is_a_setting() -> None:
    row = account(1, GIRO, through="2026-10-20")
    wide = Settings.from_env({"BANK_SYNC_OVERLAP_DAYS": "10"})

    assert bank_sync.window_start(row, TODAY, wide) == date(2026, 10, 10)


def test_twins_get_their_own_keys_and_the_prefix_is_the_firefly_id(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO)])
    client = FakeClient({GIRO: [record("-4.20"), record("-4.20"), record("-9.99", "Kino")]})

    run(kasten, client, tmp_path)

    digest = hashlib.sha1(b"B\xc3\xa4ckerei Lastschrift", usedforsecurity=False).hexdigest()[:12]
    firefly = f"dkb:{GIRO}:2026-10-20:-4.20:9310:{digest}"
    keys = [b["source_key"] for b in kasten.bookings]
    assert keys[:2] == [f"{firefly}:0", f"{firefly}:1"]
    assert keys[2].endswith(":0")
    assert kasten.bookings[0]["raw"]["amount"] == {"amount": "-4.20", "currency": "EUR"}
    assert kasten.balances == [{"account_id": 1, "date": "2026-10-25", "amount": "1234.56"}]


def test_a_second_pull_of_the_same_window_adds_nothing(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO)])
    client = FakeClient({GIRO: [record("-4.20"), record("-4.20")]})

    run(kasten, client, tmp_path)
    run(kasten, client, tmp_path)

    assert len(kasten.bookings) == 2
    assert kasten.finishes[1]["accounts"][0]["skipped"] == 2


def test_the_login_waits_for_the_push_tan(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO)])
    client = FakeClient({GIRO: [record("-4.20")]}, login_tan=True, approve_after=3)
    clock = Clock()

    assert run(kasten, client, tmp_path, clock) == 0

    assert clock.slept == 15
    assert len(kasten.bookings) == 1


def test_a_tan_never_approved_fails_the_run_after_the_wait(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO)])
    client = FakeClient({GIRO: [record("-4.20")]}, login_tan=True, approve_after=None)
    clock = Clock()

    assert run(kasten, client, tmp_path, clock) == 1

    assert clock.slept == DECOUPLED_POLL_MAX
    assert kasten.bookings == []
    assert kasten.finishes[0]["outcome"] == "failed"
    assert "TAN not approved within 240s" in kasten.finishes[0]["error"]


def test_a_tan_to_type_fails_a_headless_run(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO)])
    client = FakeClient({GIRO: Tan(decoupled=False)})

    assert run(kasten, client, tmp_path) == 1

    assert "TAN to type" in kasten.finishes[0]["error"]


def test_a_camt_fetch_resumed_after_a_tan_is_parsed(tmp_path: Path) -> None:
    # python-fints 5.0.1 hands back the raw (booked, pending) streams here.
    kasten = FakeKasten([account(1, GIRO)])
    client = FakeClient({GIRO: Tan(then=([CAMT], []))})

    assert run(kasten, client, tmp_path) == 0

    [booking] = kasten.bookings
    assert booking["amount"] == "-12.50"
    assert booking["booking_date"] == "2026-10-21"
    assert booking["value_date"] == "2026-10-20"
    assert booking["counterparty_name"] == "REWE"
    assert booking["bank_ref"] == "E2E-1"
    assert booking["source_key"].startswith(f"dkb:{GIRO}:2026-10-20:-12.50:E2E-1:")


def test_a_failed_account_fails_the_run_and_the_others_still_come_in(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO), account(2, SAVING)])
    client = FakeClient({GIRO: [record("-4.20")], SAVING: [record("100.00")]}, fail={GIRO})

    assert run(kasten, client, tmp_path) == 1

    lines = {line["account_id"]: line for line in kasten.finishes[0]["accounts"]}
    assert lines[1]["outcome"] == "failed"
    assert lines[1]["error"] == "Konto gesperrt"
    assert lines[2]["outcome"] == "ok"
    assert [b["account_id"] for b in kasten.bookings] == [2]


def test_an_iban_kasten_does_not_know_fails_the_run(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO)])
    client = FakeClient({GIRO: [], SAVING: [record("1.00")]})

    assert run(kasten, client, tmp_path) == 1

    assert f"no kasten account has the IBAN {SAVING}" in kasten.finishes[0]["error"]


def test_another_run_going_is_no_failure(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO)], busy=True)
    client = FakeClient({GIRO: [record("-4.20")]})

    assert run(kasten, client, tmp_path) == 0

    assert client.windows == {}


def test_the_state_is_saved_for_the_owner_alone(tmp_path: Path) -> None:
    run(FakeKasten([account(1, GIRO)]), FakeClient({GIRO: []}), tmp_path)

    state = tmp_path / "dkb.bin"
    assert state.read_bytes() == b"state"
    assert state.stat().st_mode & 0o777 == 0o600


def test_the_pin_is_never_logged(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client = FakeClient({GIRO: [record("-4.20")]}, fail={GIRO})

    run(FakeKasten([account(1, GIRO)]), client, tmp_path)

    assert PIN not in caplog.text
    assert PIN not in repr(dkb(tmp_path))


def test_check_fails_after_a_week_without_success(tmp_path: Path) -> None:
    assert bank_sync.check(FakeKasten([], days_since_success=6).api(), settings(tmp_path)) == 0
    assert bank_sync.check(FakeKasten([], days_since_success=7).api(), settings(tmp_path)) == 1
    assert bank_sync.check(FakeKasten([], days_since_success=None).api(), settings(tmp_path)) == 1


def test_a_poll_with_nothing_requested_exits_without_the_bank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    kasten = FakeKasten([account(1, GIRO)], requested=False)
    monkeypatch.setattr(bank_sync, "KastenApi", lambda _client: kasten.api())
    monkeypatch.setattr(bank_sync.os, "environ", {})
    monkeypatch.setattr(bank_sync.fints_bank, "make_client", pytest.fail)

    assert bank_sync.main(["poll"]) == 0

    assert kasten.finishes == []
    assert kasten.status_reads == 0


def test_a_bank_with_a_variable_missing_names_it() -> None:
    with pytest.raises(ValueError, match="DKB_PIN, DKB_FINTS_URL"):
        bank_sync.bank_from_env("DKB", {"DKB_BLZ": "1", "DKB_LOGIN": "x"}, Path("/state"))


def test_setup_chooses_the_push_tan_and_saves_the_state(tmp_path: Path) -> None:
    client = FakeClient({GIRO: []}, login_tan=True)

    fints_bank.setup(
        dkb(tmp_path), make=lambda _bank, _state: cast("FinTS3PinTanClient", client), sleep=Clock()
    )

    assert client.mechanism == "940"
    assert (tmp_path / "dkb.bin").read_bytes() == b"state"


def test_twins_split_over_two_windows_are_both_kept(tmp_path: Path) -> None:
    # The bank selects by booking date and the key holds the value date: the
    # second twin, booked a day later, is outside the first window and inside
    # the second, which the overlap makes hold both.
    kasten = FakeKasten([account(1, GIRO)])
    first = FakeClient({GIRO: [record("-4.20")]})
    second = FakeClient({GIRO: [record("-4.20"), record("-4.20")]})

    run(kasten, first, tmp_path)
    run(kasten, second, tmp_path)

    assert [b["source_key"][-2:] for b in kasten.bookings] == [":0", ":1"]


def test_a_refused_post_fails_that_account_and_the_others_still_come_in(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO), account(2, SAVING)], refuse={1})
    client = FakeClient({GIRO: [record("-4.20")], SAVING: [record("100.00")]})

    assert run(kasten, client, tmp_path) == 1

    lines = {line["account_id"]: line for line in kasten.finishes[0]["accounts"]}
    assert lines[1]["outcome"] == "failed"
    assert lines[1]["error"] == 'kasten answered 422: {"detail":"No account with id 1"}'
    assert lines[2]["outcome"] == "ok"
    assert "kasten answered 422" in kasten.finishes[0]["error"]


def test_a_tan_timing_out_on_one_account_keeps_the_others_and_the_state(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO), account(2, SAVING)])
    client = FakeClient({GIRO: [], SAVING: [record("100.00")]}, tan_for={GIRO}, approve_after=None)

    assert run(kasten, client, tmp_path) == 1

    lines = {line["account_id"]: line for line in kasten.finishes[0]["accounts"]}
    assert "TAN not approved" in lines[1]["error"]
    assert lines[2]["outcome"] == "ok"
    assert (tmp_path / "dkb.bin").read_bytes() == b"state"


def test_an_iban_to_skip_is_neither_fetched_nor_an_error(tmp_path: Path) -> None:
    kasten = FakeKasten([account(1, GIRO)])
    client = FakeClient({GIRO: [], SAVING: [record("1.00")]})
    skipping = Settings.from_env({"BANK_SYNC_SKIP_IBANS": f" {SAVING[:4]} {SAVING[4:]} ,"})

    code = bank_sync.pull(
        kasten.api(),
        [dkb(tmp_path)],
        skipping,
        "request",
        today=TODAY,
        make=lambda _bank, _state: cast("FinTS3PinTanClient", client),
        sleep=Clock(),
    )

    assert code == 0
    assert SAVING not in client.windows


def test_the_state_is_replaced_whole(tmp_path: Path) -> None:
    (tmp_path / "dkb.bin").write_bytes(b"old")

    run(FakeKasten([account(1, GIRO)]), FakeClient({GIRO: []}), tmp_path)

    assert [p.name for p in tmp_path.iterdir()] == ["dkb.bin"]
    assert (tmp_path / "dkb.bin").read_bytes() == b"state"
