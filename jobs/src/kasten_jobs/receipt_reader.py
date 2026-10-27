"""Read one receipt with Claude: its date, total, payee, the labour share, and a tax line.

The file goes to headless Claude Code (`claude -p`), which runs on the
owner's Claude subscription through `CLAUDE_CODE_OAUTH_TOKEN`. Claude Code
reads the file with its Read tool, confined to a fresh folder holding only
the receipt, and answers JSON in a fixed schema. Nothing here decides
anything: kasten proposes a booking and a mark from what comes back, and the
owner confirms. See docs/reference/receipt-jobs.md.
"""

import datetime as dt
import json
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

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
    """No usable answer this time, such as a reply that is not JSON: asked again."""


class SetupError(RuntimeError):
    """The token is missing or wrong, or the model is not there: the run fails loudly."""


class RefusedError(RuntimeError):
    """The API will not take this file: asking again gets the same answer."""


class BusyError(RuntimeError):
    """The API is busy, away or out of the subscription's limits, or Claude Code hung."""


SUFFIX = {"application/pdf": ".pdf", "image/png": ".png"}
"""The file name tells Claude Code's Read tool what it holds; anything else is a photo."""

TIMEOUT = 180
"""Seconds one reading may take; a receipt takes about ten."""


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


def _env(home: Path, token: str) -> dict[str, str]:
    """Claude Code's environment, built from nothing so no other key leaks in.

    `ANTHROPIC_API_KEY` in particular would win over the token and bill the
    API account. HOME is a fresh folder: the container user has no home of
    its own, and Claude Code writes its config there.
    """
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(home),
        "CLAUDE_CODE_OAUTH_TOKEN": token,
        "DISABLE_AUTOUPDATER": "1",
        "DISABLE_TELEMETRY": "1",
        "DISABLE_ERROR_REPORTING": "1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    }


FILE_FAULTS = ("image_error", "prompt_too_long")
"""The `terminal_reason`s that blame the file: asking again gets the same answer."""


def _answer(done: subprocess.CompletedProcess[str]) -> dict[str, Any] | None:
    """The schema's JSON from Claude Code's result, None for a decline, or the error it names.

    Every error that is not the file's own stops the run and leaves the
    receipt unread, so a broken setup never turns the queue into error readings.
    """
    try:
        result = json.loads(done.stdout)
    except json.JSONDecodeError:
        result = None
    if not isinstance(result, dict):
        # No result at all: an unknown flag after an update, or a crash.
        msg = f"Claude Code exited {done.returncode} with no JSON result: {done.stderr[-300:]!r}"
        raise SetupError(msg)
    why = str(result.get("result") or "")[:300]
    status = result.get("api_error_status")
    reason = result.get("terminal_reason")
    if result.get("is_error"):
        if status in (401, 403, 404) or "Not logged in" in why:
            raise SetupError(why)
        if status == HTTPStatus.REQUEST_ENTITY_TOO_LARGE or reason in FILE_FAULTS:
            raise RefusedError(why)
        if status == HTTPStatus.BAD_REQUEST:
            # A model the plan lacks, a Claude Code too old, a schema refused:
            # the setup's fault, not the file's.
            raise SetupError(why)
        # 429 and 5xx, the usage limit (`blocking_limit`), no network, and
        # whatever else Claude Code reports: the next run tries again.
        raise BusyError(why)
    if result.get("stop_reason") == "refusal":
        return None
    answer = result.get("structured_output")
    if not isinstance(answer, dict):
        msg = f"The result held no structured output: {why!r}"
        raise UnansweredError(msg)
    return answer


@dataclass
class ClaudeReader:
    """Reads a receipt with one run of headless Claude Code."""

    token: str = field(repr=False)
    model: str = MODEL
    timeout: float = TIMEOUT
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run

    def command(self, name: str) -> list[str]:
        """The `claude -p` line that reads the file `name` in the working folder.

        Only the Read tool, confined to the working folder by `--restricted`,
        so a receipt that asks for more gets nothing.
        """
        return [
            "claude",
            "-p",
            f"Read the receipt at ./{name}.",
            "--model",
            self.model,
            "--effort",
            "low",
            "--system-prompt",
            INSTRUCTIONS,
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(SCHEMA),
            "--restricted",
            "--tools",
            "Read",
            "--allowedTools",
            "Read",
            "--permission-mode",
            "dontAsk",
            "--strict-mcp-config",
            "--no-session-persistence",
        ]

    def read(self, data: bytes, media_type: str) -> dict[str, Any]:
        """What the receipt says, as a reading for kasten; a reading with `error` when declined.

        Raises `UnansweredError` for a reply it cannot use, and `RefusedError`,
        `BusyError` and `SetupError` for the caller to sort into done, stop
        and fail.
        """
        with tempfile.TemporaryDirectory(prefix="kasten-receipt-") as temp:
            home, folder = Path(temp, "home"), Path(temp, "receipt")
            home.mkdir()
            folder.mkdir()
            name = "receipt" + SUFFIX.get(media_type, ".jpg")
            (folder / name).write_bytes(data)
            try:
                done = self.run(
                    self.command(name),
                    cwd=folder,
                    env=_env(home, self.token),
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                    check=False,
                )
            except subprocess.TimeoutExpired as error:
                msg = f"Claude Code took more than {self.timeout:g} seconds"
                raise BusyError(msg) from error
        answer = _answer(done)
        if answer is None:
            return {"error": "The model declined to read this file"}
        return reading(answer)
