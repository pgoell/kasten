"""The receipt job: collect PDF receipts from Gmail, and read every receipt kasten holds unread.

`mail` sends kasten each PDF attached to a mail under the `Receipt` label;
kasten keeps each file once by its hash, so every run sends the whole window
again and changes nothing it already has. `read` reads each unread receipt
with Claude and sends kasten what it found; kasten proposes a booking and a
tax mark from it, which the owner confirms in the finance pane. `run` does
both. It never writes to the mailbox. See docs/how-to/collect-receipts.md and
docs/reference/receipt-jobs.md.
"""

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

import anthropic
import httpx

from kasten_jobs.gmail import Gmail
from kasten_jobs.kasten_api import KastenApi
from kasten_jobs.receipt_reader import MODEL, ClaudeReader, UnansweredError

if TYPE_CHECKING:
    from collections.abc import Mapping

    from kasten_jobs.gmail import Attachment

log = logging.getLogger("kasten_jobs.receipts")


class Mailbox(Protocol):
    """The two reads the mail half makes."""

    def search(self, query: str) -> list[str]:
        """The ids of the messages a Gmail search finds."""
        ...

    def pdfs(self, message_id: str) -> list[Attachment]:
        """The PDF files one message carries."""
        ...


class Reader(Protocol):
    """What reads one receipt: a reading for kasten, or an error to skip it this run."""

    def read(self, data: bytes, media_type: str) -> dict[str, Any]:
        """What the receipt says."""
        ...


@dataclass(frozen=True)
class Settings:
    """What the env file sets. Every name and default is in docs/reference/receipt-jobs.md."""

    api: str
    credentials: Path
    label: str
    days: int
    model: str

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        """Read the settings, each with its default. The API key is the SDK's to read."""
        return cls(
            api=env.get("KASTEN_API", "http://kasten-backend-prod:8000"),
            credentials=Path(env.get("RECEIPTS_GMAIL_CREDENTIALS", "/gmail.json")),
            label=env.get("RECEIPTS_LABEL", "Receipt"),
            days=int(env.get("RECEIPTS_DAYS", "30")),
            model=env.get("RECEIPTS_MODEL", MODEL),
        )


def query(label: str, days: int) -> str:
    """The Gmail search for mails under the label with a PDF attached."""
    return f'label:"{label}" has:attachment filename:pdf newer_than:{days}d'


def collect(api: KastenApi, mailbox: Mailbox, label: str, days: int) -> dict[str, int]:
    """Send kasten every PDF of the labelled mails of the last `days`; count what it did.

    A mail Gmail will not hand over is skipped and counted; one that fails
    never costs the run.
    """
    counts = {"new": 0, "known": 0, "refused": 0, "skipped": 0}
    for message_id in mailbox.search(query(label, days)):
        try:
            files = mailbox.pdfs(message_id)
        except httpx.HTTPStatusError as error:
            counts["skipped"] += 1
            log.warning("Skipped mail %s: %s", message_id, error)
            continue
        for file in files:
            answer = api.post_receipt(file.data, file.name, "mail")
            if answer is None:
                counts["refused"] += 1
            else:
                counts["new" if answer["created"] else "known"] += 1
    log.info("Receipt mails: %s", counts)
    return counts


UNREADABLE = (anthropic.BadRequestError, anthropic.RequestTooLargeError)
"""The API will not take this file: asking again gets the same answer, so it is done."""

RETRY = (UnansweredError, json.JSONDecodeError)
"""A reply cut off or not JSON: asked again, up to `TRIES` times in one run."""

TRIES = 3

STOP = (
    anthropic.RateLimitError,
    anthropic.InternalServerError,
    anthropic.OverloadedError,
    anthropic.ServiceUnavailableError,
    anthropic.APIConnectionError,
)
"""The API is busy or away: the run ends there and the next one reads the rest."""


def _why(refused: anthropic.APIStatusError) -> str:
    """The API's own sentence for a refusal, without the status line around it."""
    body = refused.body
    if isinstance(body, dict) and isinstance(error := body.get("error"), dict):
        return str(error.get("message", refused.message))
    return refused.message


def _reading(reader: Reader, data: bytes, media_type: str) -> dict[str, Any]:
    """What the receipt says, or a reading with `error` once it cannot be read.

    A receipt that ends with an error reading is never sent to the API again,
    so a file it refuses costs one call, not one an hour.
    """
    for attempt in range(1, TRIES + 1):
        try:
            return reader.read(data, media_type)
        except UNREADABLE as refused:
            return {"error": f"The reader could not take this file: {_why(refused)}"[:500]}
        except RETRY as error:
            log.warning("Reply %d of %d for a receipt was no answer: %s", attempt, TRIES, error)
    return {"error": f"No usable answer in {TRIES} tries"}


def read_all(api: KastenApi, reader: Reader) -> dict[str, int]:
    """Read every unread receipt, oldest first, and send kasten each reading.

    A bad key or a model that is not there raises, failing the run before it
    reads anything. A busy or unreachable API ends the run; see `STOP`.
    """
    counts = {"read": 0, "unreadable": 0, "skipped": 0, "stopped": 0}
    after: int | None = None
    while page := api.unread_receipts(after):
        for receipt in page:
            after = receipt["id"]
            try:
                data = api.receipt_file(receipt["id"])
                reading = _reading(reader, data, receipt["media_type"])
                api.put_reading(receipt["id"], reading)
            except httpx.HTTPStatusError as error:
                # Kasten has no file for it, or the receipt went meanwhile.
                counts["skipped"] += 1
                log.warning("Skipped receipt %s: %s", receipt["id"], error)
                continue
            except STOP as error:
                counts["stopped"] = 1
                log.warning("Stopped at receipt %s: %s", receipt["id"], error)
                return counts
            counts["unreadable" if "error" in reading else "read"] += 1
    log.info("Receipts read: %s", counts)
    return counts


def failed(counts: dict[str, int]) -> bool:
    """Whether the run should fail: only when the API stopped it, never for one bad file."""
    return bool(counts["stopped"])


def main(argv: list[str] | None = None) -> int:
    """Read the env, run the command, and answer its exit code."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    # httpx logs each request's URL at INFO, and a Gmail search's URL holds the query.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(prog="kasten-receipts")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("mail", help="send kasten the PDFs of the labelled mails")
    commands.add_parser("read", help="read the unread receipts with Claude")
    commands.add_parser("run", help="mail, then read")
    command = parser.parse_args(argv).command

    settings = Settings.from_env(os.environ)
    status = 0
    with httpx.Client(base_url=settings.api, timeout=60) as client:
        api = KastenApi(client)
        if command in ("mail", "run"):
            with httpx.Client(timeout=30) as google:
                collect(
                    api,
                    Gmail.from_file(google, settings.credentials),
                    settings.label,
                    settings.days,
                )
        if command in ("read", "run"):
            reader = ClaudeReader(anthropic.Anthropic(), settings.model)
            status = 1 if failed(read_all(api, reader)) else 0
    return status


if __name__ == "__main__":
    sys.exit(main())
