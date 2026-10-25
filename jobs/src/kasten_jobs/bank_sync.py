"""The bank sync job: pull each bank over FinTS and write the bookings through kasten.

`poll` runs every minute and ends at once unless a "pull now" waits; `pull`
is the one scheduled attempt a day; `check` fails when no run has succeeded
for a week; `setup <bank>` is the one-time login by hand. Every run is
recorded in kasten, and a failed one exits 1 so a systemd `OnFailure=` can
alert. See docs/how-to/run-the-bank-sync.md and docs/reference/bank-sync.md.
"""

import argparse
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
from fints.exceptions import FinTSError

from kasten_jobs import fints_bank
from kasten_jobs.bookings import to_bookings
from kasten_jobs.kasten_api import KastenApi

if TYPE_CHECKING:
    from collections.abc import Mapping

    from kasten_jobs.fints_bank import AccountPull, Bank, MakeClient, Sleep

log = logging.getLogger("kasten_jobs.bank_sync")


@dataclass(frozen=True)
class Settings:
    """What the env file sets. Every name and default is in docs/reference/bank-sync.md."""

    api: str
    banks: tuple[str, ...]
    state_dir: Path
    overlap_days: int
    first_days: int
    stale_days: int
    skip_ibans: frozenset[str]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        """Read the settings, each with its default."""
        return cls(
            api=env.get("KASTEN_API", "http://kasten-backend-prod:8000"),
            banks=tuple(
                b.strip().upper() for b in env.get("BANK_SYNC_BANKS", "DKB,PSD").split(",")
            ),
            state_dir=Path(env.get("BANK_SYNC_STATE_DIR", "/state")),
            overlap_days=int(env.get("BANK_SYNC_OVERLAP_DAYS", "14")),
            first_days=int(env.get("BANK_SYNC_FIRST_DAYS", "90")),
            stale_days=int(env.get("BANK_SYNC_STALE_DAYS", "7")),
            skip_ibans=frozenset(
                _spelled(i) for i in env.get("BANK_SYNC_SKIP_IBANS", "").split(",") if i.strip()
            ),
        )


def bank_from_env(prefix: str, env: Mapping[str, str], state_dir: Path) -> Bank:
    """The login a prefix names, `DKB_LOGIN` and the rest, the same names the importer read."""
    missing = [
        f"{prefix}_{k}"
        for k in ("BLZ", "LOGIN", "PIN", "FINTS_URL")
        if not env.get(f"{prefix}_{k}")
    ]
    if missing:
        msg = f"Not set: {', '.join(missing)}"
        raise ValueError(msg)
    return fints_bank.Bank(
        name=prefix.lower(),
        blz=env[f"{prefix}_BLZ"],
        login=env[f"{prefix}_LOGIN"],
        pin=env[f"{prefix}_PIN"],
        fints_url=env[f"{prefix}_FINTS_URL"],
        state_path=state_dir / f"{prefix.lower()}.bin",
    )


def _spelled(iban: str | None) -> str:
    return "".join((iban or "").split()).upper()


def window_start(row: dict[str, Any] | None, today: date, settings: Settings) -> date:
    """Where an account's window starts.

    `overlap_days` before the last good window ended, so a booking the bank
    posts late still comes in; else, on a first pull, `overlap_days` before
    the newest booking stored (the Firefly history), since Firefly kept the
    value date and the bank picks by booking date; else `first_days` back.

    The overlap also keeps the occurrence index of the source key honest. The
    bank selects a window by booking date and the key holds the value date,
    so twins (same value date, amount, reference and purpose) are counted
    right only while one window sees all of them: they must be booked within
    the overlap of each other. Two weeks is far more than banks take.
    """
    if row and row["last_good_through"]:
        return date.fromisoformat(row["last_good_through"]) - timedelta(settings.overlap_days)
    if row and row["newest_booking"]:
        return date.fromisoformat(row["newest_booking"]) - timedelta(settings.overlap_days)
    return today - timedelta(settings.first_days)


@dataclass
class Run:
    """One run: what it reaches, and what it gathers for the finish it reports."""

    api: KastenApi
    settings: Settings
    today: date
    make: MakeClient
    sleep: Sleep
    rows: dict[str, dict[str, Any]] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    accounts: list[dict[str, Any]] = field(default_factory=list)

    def since_for(self, bank: Bank, iban: str) -> date | None:
        """Where the window of the account with this IBAN starts, or None to leave it out.

        An IBAN in `skip_ibans` is left out quietly. One no kasten account
        holds is left out and fails the run, naming it.
        """
        spelled = _spelled(iban)
        if spelled in self.settings.skip_ibans:
            log.info("[%s] %s: skipped, BANK_SYNC_SKIP_IBANS names it", bank.name, iban)
            return None
        row = self.rows.get(spelled)
        if row is None:
            self.errors.append(f"{bank.name}: no kasten account has the IBAN {iban}")
            return None
        return window_start(row, self.today, self.settings)


def _refusal(error: httpx.HTTPError) -> str:
    # The answer's body says what kasten refused; it holds bookings at most,
    # never a login. Cut short, since a 422 can echo a whole batch back.
    if isinstance(error, httpx.HTTPStatusError):
        return f"kasten answered {error.response.status_code}: {error.response.text[:500]}"
    return f"kasten unreachable: {error}"


def _store(run: Run, bank: Bank, account_id: int, pull: AccountPull) -> dict[str, Any]:
    line: dict[str, Any] = {
        "account_id": account_id,
        "fetched_from": str(pull.since),
        "fetched_through": str(pull.until),
    }
    if pull.error:
        return {**line, "outcome": "failed", "error": pull.error}
    bookings = to_bookings(bank.name, pull.iban, account_id, pull.records, frozenset(run.rows))
    try:
        created, skipped = run.api.post_bookings(bookings)
        if pull.balance:
            day, amount = pull.balance
            balance = {"account_id": account_id, "date": str(day), "amount": str(amount)}
            run.api.post_balances([balance])
    except httpx.HTTPError as error:
        log.error("[%s] %s: %s", bank.name, pull.iban, _refusal(error))
        return {**line, "outcome": "failed", "error": _refusal(error)}
    log.info("[%s] %s: %d new, %d known", bank.name, pull.iban, created, skipped)
    return {**line, "outcome": "ok", "created": created, "skipped": skipped}


def _pull_bank(run: Run, bank: Bank) -> None:
    try:
        pulls = fints_bank.fetch(
            bank, lambda iban: run.since_for(bank, iban), run.today, make=run.make, sleep=run.sleep
        )
    except (FinTSError, fints_bank.BankError, TimeoutError) as error:
        log.error("[%s] %s", bank.name, error)
        run.errors.append(f"{bank.name}: {error}")
        return
    for pull in pulls:
        line = _store(run, bank, run.rows[_spelled(pull.iban)]["account_id"], pull)
        run.accounts.append(line)
        if line["outcome"] == "failed":
            run.errors.append(f"{bank.name}: {pull.iban}: {line['error']}")


def pull(  # noqa: PLR0913  the trigger, and what the tests swap out
    api: KastenApi,
    banks: list[Bank],
    settings: Settings,
    trigger: str,
    *,
    today: date,
    make: MakeClient = fints_bank.make_client,
    sleep: Sleep = time.sleep,
) -> int:
    """Start a run, pull every bank, record the outcome, and answer the exit code.

    0 when every account came in, or when another run had the start; 1 when
    anything failed.
    """
    started = api.start_run(trigger)
    if started is None:
        log.info("Another run is going, or took the request first")
        return 0
    run = Run(api, settings, today, make, sleep)
    finished = False
    try:
        accounts = api.status()["accounts"]
        run.rows = {_spelled(row["iban"]): row for row in accounts if row["iban"]}
        for bank in banks:
            _pull_bank(run, bank)
        outcome = "failed" if run.errors else "ok"
        error = "; ".join(run.errors) or None
        api.finish_run(
            started["id"], {"outcome": outcome, "error": error, "accounts": run.accounts}
        )
        finished = True
    finally:
        # Not a catch: whatever broke still propagates and fails the job, but
        # kasten hears the run ended rather than waiting out the timeout.
        if not finished:
            stopped = {"outcome": "failed", "error": "the job stopped; see its log"}
            api.finish_run(started["id"], {**stopped, "accounts": run.accounts})
    return 1 if run.errors else 0


def check(api: KastenApi, settings: Settings) -> int:
    """1 when no run has succeeded for `stale_days`, or ever."""
    days = api.status()["days_since_success"]
    if days is None or days >= settings.stale_days:
        log.error("No bank sync has succeeded for %s days", "any" if days is None else days)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    """Read the env, run the command, and answer its exit code."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    # python-fints logs whole messages at DEBUG, the login among them.
    logging.getLogger("fints").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(prog="kasten-bank-sync")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("poll", help="pull if a 'pull now' waits, else exit at once")
    commands.add_parser("pull", help="the scheduled pull")
    commands.add_parser("check", help="fail when no run succeeded for BANK_SYNC_STALE_DAYS")
    commands.add_parser("setup", help="one-time login by hand").add_argument("bank")
    args = parser.parse_args(argv)

    settings = Settings.from_env(os.environ)
    if args.command == "setup":
        fints_bank.setup(bank_from_env(args.bank.upper(), os.environ, settings.state_dir))
        return 0
    with httpx.Client(base_url=settings.api, timeout=30) as client:
        api = KastenApi(client)
        if args.command == "check":
            return check(api, settings)
        if args.command == "poll" and not api.request_open():
            return 0
        banks = [bank_from_env(prefix, os.environ, settings.state_dir) for prefix in settings.banks]
        trigger = "request" if args.command == "poll" else "scheduled"
        return pull(api, banks, settings, trigger, today=date.today())


if __name__ == "__main__":
    sys.exit(main())
