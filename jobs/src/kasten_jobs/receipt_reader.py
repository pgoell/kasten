"""Read one receipt with Claude: its date, total, payee, the labour share, and a tax line.

The file goes to the Messages API as it is, a PDF as a document and a photo
as an image, and the answer comes back as JSON in a fixed schema. Nothing
here decides anything: kasten proposes a booking and a mark from what comes
back, and the owner confirms. See docs/reference/receipt-jobs.md.
"""

import base64
import datetime as dt
import json
import logging
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import anthropic
    from anthropic.types.beta import (
        BetaImageBlockParam,
        BetaMessageParam,
        BetaRequestDocumentBlockParam,
    )

log = logging.getLogger("kasten_jobs.receipt_reader")

MODEL = "claude-sonnet-5-5"

LINES = (
    "werbungskosten",
    "sonderausgaben",
    "haushaltsnahe_dienste",
    "handwerker",
    "aussergewoehnliche_belastungen",
)

INSTRUCTIONS = """\
You read one receipt or invoice for a German employee's tax return. Report:

- date: the invoice or receipt date, as YYYY-MM-DD.
- total: the gross amount paid, VAT included, in euros, like "476.00".
- payee: who issued it, the company or person, without legal form if you can.
- labour: only for a craftsman or household service invoice (§35a EStG): the \
labour, travel and machine costs with their VAT, without materials, like \
"300.00". Null on any other receipt, or when the invoice does not show them apart.
- form_line: the line of the return it most likely belongs on, or null when \
it is a private purchase or you cannot tell:
  werbungskosten (work costs: work equipment, books, training, travel for work),
  sonderausgaben (donations, insurance premiums, church tax, pension contracts),
  haushaltsnahe_dienste (cleaning, gardening, care at home: §35a services),
  handwerker (repairs, painting, maintenance in the home: §35a craftsmen),
  aussergewoehnliche_belastungen (medical costs, glasses, medicine, care).
- is_receipt: false when the file is no receipt or invoice at all.

Use null for anything the document does not show. Never guess an amount.\
"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_receipt": {"type": "boolean"},
        "date": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "total": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "payee": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "labour": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "form_line": {"anyOf": [{"type": "string", "enum": list(LINES)}, {"type": "null"}]},
    },
    "required": ["is_receipt", "date", "total", "payee", "labour", "form_line"],
    "additionalProperties": False,
}


class UnansweredError(RuntimeError):
    """No answer this time, such as a cut-off reply: the receipt stays unread for the next run."""


def _block(data: bytes, media_type: str) -> BetaRequestDocumentBlockParam | BetaImageBlockParam:
    encoded = base64.standard_b64encode(data).decode()
    if media_type == "application/pdf":
        return {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": encoded},
        }
    image = "image/png" if media_type == "image/png" else "image/jpeg"
    return {"type": "image", "source": {"type": "base64", "media_type": image, "data": encoded}}


LARGEST = Decimal(10) ** 12
"""The first amount `numeric(14,2)` cannot hold."""


def _amount(text: object) -> str | None:
    """A positive amount to the cent, as kasten takes it, or None for what reads as none.

    `NaN`, `Infinity` and anything of 10^12 or more read as none: kasten keeps
    amounts in `numeric(14,2)` and would refuse them.
    """
    if not isinstance(text, str):
        return None
    try:
        amount = Decimal(text.replace(",", ".").replace("€", "").strip())
    except InvalidOperation:
        return None
    if not amount.is_finite() or amount <= 0 or amount >= LARGEST:
        return None
    return str(amount.quantize(Decimal("0.01")))


def _date(text: object) -> str | None:
    if not isinstance(text, str):
        return None
    try:
        return dt.date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def reading(answer: dict[str, Any]) -> dict[str, Any]:
    """The model's JSON as `PUT /api/finance/receipts/{id}/reading` takes it.

    A field that does not parse is left out rather than sent wrong; kasten
    proposes nothing from what it lacks.
    """
    if not answer.get("is_receipt"):
        return {"error": "Not a receipt or invoice, the reader says"}
    payee = answer.get("payee")
    line = answer.get("form_line")
    return {
        "date": _date(answer.get("date")),
        "amount": _amount(answer.get("total")),
        "payee": payee[:200] if isinstance(payee, str) and payee.strip() else None,
        "labour": _amount(answer.get("labour")),
        "form_line": line if line in LINES else None,
    }


@dataclass
class ClaudeReader:
    """Reads a receipt with one Messages API call."""

    client: anthropic.Anthropic
    model: str = MODEL

    def read(self, data: bytes, media_type: str) -> dict[str, Any]:
        """What the receipt says, as a reading for kasten; a reading with `error` when declined.

        Raises `UnansweredError` when the reply was cut off, and lets the SDK's
        errors through for the caller to sort into skip and stop.
        """
        messages: list[BetaMessageParam] = [
            {
                "role": "user",
                "content": [
                    _block(data, media_type),
                    {"type": "text", "text": "Read this receipt."},
                ],
            }
        ]
        response = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            # On a decline by the safety classifiers the API runs the request
            # again on the model it routes that kind of decline to.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": SCHEMA},
            },
            system=INSTRUCTIONS,
            messages=messages,
        )
        if response.stop_reason == "refusal":
            return {"error": "The model declined to read this file"}
        if response.stop_reason == "max_tokens":
            msg = "The reply was cut off"
            raise UnansweredError(msg)
        text = next((block.text for block in response.content if block.type == "text"), None)
        if text is None:
            msg = "The reply held no text"
            raise UnansweredError(msg)
        return reading(json.loads(text))
