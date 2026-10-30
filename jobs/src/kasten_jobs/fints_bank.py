"""The bank side of the sync: FinTS with PIN/TAN and a decoupled (push) TAN.

PSD2 asks for a TAN on every direct FinTS login, so every pull waits for a push
approval on the phone. The client state blob (`deconstruct`) keeps the TAN
method and the bank's parameters between runs; `setup` writes it once.
"""

import logging
import os
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fints.camt_parser import camt053_to_dict
from fints.client import FinTS3PinTanClient, FinTSClientMode, NeedTANResponse
from fints.exceptions import FinTSClientError
from fints.models import Transaction

if TYPE_CHECKING:
    from collections.abc import Callable
    from datetime import date
    from decimal import Decimal

    from fints.models import SEPAAccount

log = logging.getLogger(__name__)

DECOUPLED_POLL_INTERVAL = 5
"""Seconds between two asks whether the push TAN was approved."""

DECOUPLED_POLL_MAX = 240
"""How long a run waits for the approval. The phone has to be at hand, which "pull now" is for."""

PRODUCT_ID = "9FA6681DEC0CF3046BFC2F8A6"
"""DKB refuses a free-form product id with HTTP 400; one shaped like this works with all
common German banks, and an unregistered id is tolerated for read-only access."""

DECOUPLED_NAMES = ("direktfreigabe", "securego", "decoupled", "dkb app", "pushtan")


class BankError(RuntimeError):
    """The bank answered something the sync cannot go on from."""


@dataclass(frozen=True)
class Bank:
    """One bank login. `name` is the lowercase prefix of its variables, `dkb` or `psd`."""

    name: str
    blz: str
    login: str
    # Left out of the repr, so a log line or a traceback showing a Bank never shows it.
    pin: str = field(repr=False)
    fints_url: str
    state_path: Path


@dataclass
class AccountPull:
    """What one account gave: its window, the bank's records, its balance, or an error."""

    iban: str
    since: date
    until: date
    records: list[dict[str, Any]] = field(default_factory=list)
    balance: tuple[date, Decimal] | None = None
    error: str | None = None


type Sleep = Callable[[float], None]
type MakeClient = Callable[[Bank, bytes | None], FinTS3PinTanClient]


def make_client(bank: Bank, state: bytes | None) -> FinTS3PinTanClient:
    """A client for the bank, resumed from the saved state when there is one."""
    return FinTS3PinTanClient(
        bank.blz,
        bank.login,
        bank.pin,
        bank.fints_url,
        product_id=PRODUCT_ID,
        mode=FinTSClientMode.INTERACTIVE,
        from_data=state,
    )


def _load_state(path: Path) -> bytes | None:
    return path.read_bytes() if path.exists() else None


def _save_state(path: Path, data: bytes) -> None:
    # Written beside the old file and moved over it, so a kill mid-write keeps the
    # old state whole. `mkstemp` makes it 600: it holds the bank's session parameters.
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(handle, "wb") as file:
            file.write(data)
        Path(temp).replace(path)
    finally:
        Path(temp).unlink(missing_ok=True)


def approve_tan(
    client: FinTS3PinTanClient, challenge: NeedTANResponse, *, interactive: bool, sleep: Sleep
) -> Any:
    """Drive the TAN to the end, and hand back what the operation it held up answers."""
    if not challenge.decoupled:
        if not interactive:
            msg = (
                "The bank asked for a TAN to type, which a job cannot. Run setup again, "
                f"or switch to a push TAN in the bank's app. Challenge: {challenge.challenge!r}"
            )
            raise BankError(msg)
        tan = input(f"Enter TAN ({challenge.challenge}): ").strip()
        return client.send_tan(challenge, tan)
    log.info("Waiting for the push TAN approval (up to %ds)", DECOUPLED_POLL_MAX)
    elapsed = 0
    response: Any = challenge
    while elapsed < DECOUPLED_POLL_MAX:
        sleep(DECOUPLED_POLL_INTERVAL)
        elapsed += DECOUPLED_POLL_INTERVAL
        response = client.send_tan(response, "")
        if not isinstance(response, NeedTANResponse):
            log.info("Approved after %ds", elapsed)
            return response
    msg = f"TAN not approved within {DECOUPLED_POLL_MAX}s"
    raise TimeoutError(msg)


def _resolve_initial_tan(client: FinTS3PinTanClient, *, interactive: bool, sleep: Sleep) -> None:
    if isinstance(client.init_tan_response, NeedTANResponse):
        log.info("The login asks for a TAN")
        approve_tan(client, client.init_tan_response, interactive=interactive, sleep=sleep)


def pick_decoupled_method(mechanisms: dict[str, Any]) -> str | None:
    """The code of a push TAN method among the bank's, or None.

    `allowed_format is None` marks a push method, there being no TAN to type.
    The names are the fallback.
    """
    for code, mechanism in mechanisms.items():
        if getattr(mechanism, "allowed_format", "x") is None:
            return code
    for code, mechanism in mechanisms.items():
        name = (getattr(mechanism, "name", "") or "").lower()
        if any(word in name for word in DECOUPLED_NAMES):
            return code
    return None


def setup(bank: Bank, *, make: MakeClient = make_client, sleep: Sleep = time.sleep) -> None:
    """Log in once by hand, choose the push TAN method, and save the state every run resumes."""
    client = make(bank, _load_state(bank.state_path))
    with client:
        _resolve_initial_tan(client, interactive=True, sleep=sleep)
        mechanisms = client.get_tan_mechanisms()
        for code, mechanism in mechanisms.items():
            log.info("[%s] TAN method %s: %s", bank.name, code, getattr(mechanism, "name", "?"))
        current = client.get_current_tan_mechanism()
        decoupled = pick_decoupled_method(mechanisms)
        log.info("[%s] Active TAN method %s, push candidate %s", bank.name, current, decoupled)
        for account in client.get_sepa_accounts():
            log.info("[%s] Account %s (number %s)", bank.name, account.iban, account.accountnumber)
    # Only outside the dialog may the method change.
    if decoupled and decoupled != current:
        client.set_tan_mechanism(decoupled)
        log.info("[%s] TAN method switched from %s to %s", bank.name, current, decoupled)
    elif not decoupled:
        log.warning(
            "[%s] No push TAN method. A job cannot type a TAN: turn on the bank's app "
            "approval (DKB app, SecureGo plus) and run setup again.",
            bank.name,
        )
    _save_state(bank.state_path, client.deconstruct(including_private=True))
    log.info("[%s] State saved to %s", bank.name, bank.state_path)


def _records(client: FinTS3PinTanClient, account: SEPAAccount, pull: AccountPull, sleep: Sleep):
    response = client.get_transactions(account, pull.since, pull.until)
    if isinstance(response, NeedTANResponse):
        response = approve_tan(client, response, interactive=False, sleep=sleep)
    # A CAMT fetch resumed after a TAN skips get_transactions' parsing in
    # python-fints 5.0.1 and hands back the raw (booked, pending) streams.
    if isinstance(response, tuple):
        booked, _pending = response
        response = [Transaction(record) for stream in booked for record in camt053_to_dict(stream)]
    if not isinstance(response, list):
        msg = f"unexpected answer {type(response).__name__} to the transactions fetch"
        raise BankError(msg)
    return [statement.data for statement in response]


def _balance(
    client: FinTS3PinTanClient, account: SEPAAccount, sleep: Sleep
) -> tuple[date, Decimal] | None:
    # A balance missing is a warning, not a failed pull: the bookings are what counts.
    try:
        response = client.get_balance(account)
        if isinstance(response, NeedTANResponse):
            response = approve_tan(client, response, interactive=False, sleep=sleep)
    except (FinTSClientError, BankError, TimeoutError) as error:
        log.warning("%s: no balance: %s", account.iban, error)
        return None
    amount = getattr(getattr(response, "amount", None), "amount", None)
    day = getattr(response, "date", None)
    if amount is None or day is None:
        log.warning("%s: no balance in the answer %s", account.iban, type(response).__name__)
        return None
    return day, amount


def fetch(
    bank: Bank,
    since_for: Callable[[str], date | None],
    until: date,
    *,
    make: MakeClient = make_client,
    sleep: Sleep = time.sleep,
) -> list[AccountPull]:
    """Pull each of the bank's accounts from the day `since_for` names for its IBAN.

    A failed account is a pull with an error, and the others go on. A failed login raises.
    """
    log.info("[%s] Connecting", bank.name)
    client = make(bank, _load_state(bank.state_path))
    pulls: list[AccountPull] = []
    with client:
        _resolve_initial_tan(client, interactive=False, sleep=sleep)
        for account in client.get_sepa_accounts():
            since = since_for(account.iban)
            if since is None:
                continue
            pull = AccountPull(account.iban, since, until)
            log.info("[%s] %s: %s to %s", bank.name, account.iban, since, until)
            try:
                pull.records = _records(client, account, pull, sleep)
            # A TAN timed out on one account fails that account alone: the
            # others' records and the state saved below are still good.
            except (FinTSClientError, BankError, TimeoutError) as error:
                log.error("[%s] %s: %s", bank.name, account.iban, error)
                pull.error = str(error)
            else:
                pull.balance = _balance(client, account, sleep)
            pulls.append(pull)
        _save_state(bank.state_path, client.deconstruct(including_private=True))
    return pulls
