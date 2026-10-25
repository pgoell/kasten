"""A FinTS client that talks to no bank, and records shaped as python-fints hands them back.

Never a real login: the tests drive the sync through this, the TAN waits
included, and the sleep they pass counts seconds rather than spending them.
"""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

from fints.client import NeedTANResponse
from fints.exceptions import FinTSClientError
from fints.models import Amount, SEPAAccount, Transaction
from mt940.models import Balance, Date

GIRO = "DE02120300000000202051"
SAVING = "DE02500105170137075030"

CAMT = b"""<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"><BkToCstmrAcctRpt><Rpt>
<Acct><Id><IBAN>DE02120300000000202051</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Ntry><Amt Ccy="EUR">12.50</Amt><CdtDbtInd>DBIT</CdtDbtInd>
<BookgDt><Dt>2026-10-21</Dt></BookgDt><ValDt><Dt>2026-10-20</Dt></ValDt>
<NtryDtls><TxDtls><Refs><EndToEndId>E2E-1</EndToEndId></Refs>
<RltdPties><Cdtr><Pty><Nm>REWE</Nm></Pty></Cdtr></RltdPties>
<RmtInf><Ustrd>REWE SAGT DANKE</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Rpt></BkToCstmrAcctRpt></Document>"""


class Tan(NeedTANResponse):
    """A TAN challenge. Its parent's constructor parses a real bank segment, so it is skipped."""

    def __init__(self, *, decoupled: bool = True, then: Any = None) -> None:
        self.decoupled = decoupled
        self.challenge = "Bitte in der App freigeben"
        self.then = then


def record(amount: str, purpose: str = "Bäckerei", day: date = date(2026, 10, 20)) -> Transaction:
    """One MT940 record as python-fints hands it back."""
    return Transaction(
        {
            "amount": Amount(Decimal(amount), "EUR"),
            "date": day,
            "entry_date": day,
            "purpose": purpose,
            "posting_text": "Lastschrift",
            "applicant_name": "Bäckerei Müller",
            "applicant_iban": "DE89370400440532013000",
            "prima_nota": "9310",
        }
    )


class FakeClient:
    """Answers like `FinTS3PinTanClient` for the calls the sync makes, and records them.

    `approve_after` is how many asks a push TAN takes before it is approved;
    None never approves.
    """

    def __init__(
        self,
        answers: dict[str, Any],
        *,
        login_tan: bool = False,
        approve_after: int | None = 1,
        fail: set[str] | None = None,
        tan_for: set[str] | None = None,
    ) -> None:
        self.answers = answers
        self.init_tan_response = Tan() if login_tan else None
        self.approve_after = approve_after
        self.fail = fail or set()
        # Accounts whose fetch asks for a push TAN that is never approved.
        self.tan_for = tan_for or set()
        self.windows: dict[str, tuple[date, date]] = {}
        self.asks = 0
        self.mechanism = "942"

    def __enter__(self) -> FakeClient:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def get_sepa_accounts(self) -> list[SEPAAccount]:
        return [
            SEPAAccount(iban, "BYLADEM1001", iban[-10:], None, "12030000") for iban in self.answers
        ]

    def get_transactions(self, account: SEPAAccount, since: date, until: date) -> Any:
        self.windows[account.iban] = (since, until)
        if account.iban in self.fail:
            msg = "Konto gesperrt"
            raise FinTSClientError(msg)
        if account.iban in self.tan_for:
            return Tan()
        return self.answers[account.iban]

    def get_balance(self, account: SEPAAccount) -> Balance:
        return Balance("C", "1234.56", Date(2026, 10, 25), currency="EUR")

    def send_tan(self, challenge: Tan, tan: str) -> Any:
        self.asks += 1
        if self.approve_after is None or self.asks < self.approve_after:
            return challenge
        return challenge.then

    def get_tan_mechanisms(self) -> dict[str, Any]:
        return {
            "942": SimpleNamespace(name="mobileTAN", allowed_format="numeric"),
            "940": SimpleNamespace(name="DKB App", allowed_format=None),
        }

    def get_current_tan_mechanism(self) -> str:
        return self.mechanism

    def set_tan_mechanism(self, code: str) -> None:
        self.mechanism = code

    def deconstruct(self, *, including_private: bool = False) -> bytes:
        return b"state"
