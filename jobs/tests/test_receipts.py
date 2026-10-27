"""The receipt job: PDFs from the labelled mails to kasten, and each unread receipt read by Claude.

Against a fake mailbox, a fake kasten that keeps receipts by their bytes,
and a fake `subprocess.run` in place of `claude -p`, so nothing leaves the box.
"""

import base64
import hashlib
import json
import subprocess
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import httpx
import pytest

from kasten_jobs import receipts
from kasten_jobs.gmail import Attachment, Gmail
from kasten_jobs.kasten_api import KastenApi
from kasten_jobs.receipt_reader import SCHEMA, ClaudeReader, SetupError, reading

if TYPE_CHECKING:
    from collections.abc import Iterator

PDF = b"%PDF-1.4 invoice"
QUERY = 'label:"Receipt" has:attachment filename:pdf newer_than:30d'


@dataclass
class FakeKasten:
    """Kasten's receipt routes: receipts kept once by their bytes, and the readings sent."""

    kept: dict[str, int] = field(default_factory=dict)
    unread: list[dict[str, Any]] = field(default_factory=list)
    readings: dict[int, dict[str, Any]] = field(default_factory=dict)
    gone: set[int] = field(default_factory=set)

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "POST" and path == "/api/finance/receipts":
            body = request.content
            start = body.index(b"\r\n\r\n", body.index(b'name="file"')) + 4
            digest = hashlib.sha256(body[start : body.index(b"\r\n--", start)]).hexdigest()
            created = digest not in self.kept
            self.kept.setdefault(digest, len(self.kept) + 1)
            return httpx.Response(
                200, json={"receipt": {"id": self.kept[digest]}, "created": created}
            )
        if request.method == "GET" and path == "/api/finance/receipts":
            after = int(request.url.params.get("after", "0"))
            page = [r for r in self.unread if r["id"] > after and r["id"] not in self.readings]
            return httpx.Response(200, json=page[: int(request.url.params["limit"])])
        receipt_id = int(path.split("/")[4])
        if path.endswith("/file"):
            if receipt_id in self.gone:
                return httpx.Response(404, json={"detail": "The receipt's file is gone"})
            return httpx.Response(200, content=PDF)
        self.readings[receipt_id] = json.loads(request.content)
        return httpx.Response(200, json={"id": receipt_id})

    def api(self) -> KastenApi:
        transport = httpx.MockTransport(self.handle)
        return KastenApi(httpx.Client(base_url="http://kasten", transport=transport))


@dataclass
class FakeMailbox:
    files: dict[str, list[Attachment]]
    broken: set[str] = field(default_factory=set)
    searches: list[str] = field(default_factory=list)

    def search(self, query: str) -> list[str]:
        self.searches.append(query)
        return list(self.files)

    def pdfs(self, message_id: str) -> list[Attachment]:
        if message_id in self.broken:
            request = httpx.Request("GET", "https://gmail.test")
            raise httpx.HTTPStatusError("gone", request=request, response=httpx.Response(404))
        return self.files[message_id]


def test_every_pdf_of_the_labelled_mails_goes_to_kasten_once() -> None:
    kasten = FakeKasten()
    box = FakeMailbox(
        {
            "m1": [Attachment("a.pdf", PDF), Attachment("b.pdf", PDF + b"2")],
            "m2": [Attachment("a-again.pdf", PDF)],
            "m3": [],
        },
        broken={"m3"},
    )

    first = receipts.collect(kasten.api(), box, "Receipt", 30)
    second = receipts.collect(kasten.api(), box, "Receipt", 30)

    assert box.searches == [QUERY, QUERY]
    assert first == {"new": 2, "known": 1, "refused": 0, "skipped": 1}
    assert second == {"new": 0, "known": 3, "refused": 0, "skipped": 1}


def test_gmail_hands_over_inline_and_fetched_pdfs_and_nothing_else() -> None:
    def encode(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).decode().rstrip("=")

    message = {
        "payload": {
            "parts": [
                {"mimeType": "text/plain", "body": {"data": encode(b"hi")}},
                {
                    "mimeType": "application/pdf",
                    "filename": "small.pdf",
                    "body": {"data": encode(PDF)},
                },
                {
                    "mimeType": "application/octet-stream",
                    "filename": "Rechnung.PDF",
                    "body": {"attachmentId": "att1"},
                },
                {"mimeType": "image/png", "filename": "logo.png", "body": {"data": encode(b"png")}},
            ]
        }
    }

    def google(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "t"})
        if request.url.path.endswith("/attachments/att1"):
            return httpx.Response(200, json={"data": encode(PDF + b"big")})
        return httpx.Response(200, json=message)

    client = httpx.Client(transport=httpx.MockTransport(google))
    gmail = Gmail(client, {"client_id": "c", "client_secret": "s", "refresh_token": "r"})

    found = gmail.pdfs("m1")

    assert found == [Attachment("small.pdf", PDF), Attachment("Rechnung.PDF", PDF + b"big")]


def answer(output: dict[str, Any] | None, stop: str = "end_turn") -> dict[str, Any]:
    """Claude Code's `--output-format json` result, as a successful run prints it."""
    return {
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "stop_reason": stop,
        "terminal_reason": "completed",
        "api_error_status": None,
        "result": json.dumps(output),
        "structured_output": output,
    }


def failure(status: int | None, text: str) -> dict[str, Any]:
    """The result Claude Code prints when the API call fails."""
    return {
        "type": "result",
        "subtype": "success",
        "is_error": True,
        "stop_reason": "stop_sequence",
        "terminal_reason": "api_error",
        "api_error_status": status,
        "result": text,
    }


@dataclass
class FakeClaude:
    """`subprocess.run` for `claude -p`: answers from `replies` and keeps what each run saw."""

    replies: Iterator[dict[str, Any] | str | type[BaseException]]
    runs: list[dict[str, Any]] = field(default_factory=list)

    def __call__(self, command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        cwd = kwargs["cwd"]
        files = {p.name: p.read_bytes() for p in cwd.iterdir()}
        self.runs.append({"command": command, "files": files, **kwargs})
        reply = next(self.replies)
        if isinstance(reply, type):
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])
        if isinstance(reply, str):
            return subprocess.CompletedProcess(command, 1, reply, "boom")
        code = 1 if reply["is_error"] else 0
        return subprocess.CompletedProcess(command, code, json.dumps(reply), "")


TOKEN = "sk-ant-oat01-test"  # noqa: S105  a fake, never sent


def claude(*replies: dict[str, Any] | str | type[BaseException]) -> tuple[ClaudeReader, FakeClaude]:
    fake = FakeClaude(iter(replies))
    return ClaudeReader(TOKEN, run=fake), fake


READ = {
    "is_receipt": True,
    "date": "2026-10-01",
    "total": "476,00 €",
    "payee": "Malerbetrieb Huber",
    "labour": "300",
    "form_line": "handwerker",
}


def test_a_receipt_goes_to_claude_code_whole_and_comes_back_as_a_reading(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "would-bill-the-api")
    reader, fake = claude(answer(READ))

    found = reader.read(PDF, "application/pdf")

    assert found == {
        "date": "2026-10-01",
        "amount": "476.00",
        "payee": "Malerbetrieb Huber",
        "labour": "300.00",
        "form_line": "handwerker",
    }
    [run] = fake.runs
    command = run["command"]
    assert command[:3] == ["claude", "-p", "Read the receipt at ./receipt.pdf."]
    assert command[command.index("--model") + 1] == "claude-sonnet-5-5"
    assert json.loads(command[command.index("--json-schema") + 1]) == SCHEMA
    assert command[command.index("--tools") + 1] == "Read"
    assert "--restricted" in command
    assert run["files"] == {"receipt.pdf": PDF}
    # The folder and the home are gone once the run is done.
    assert not run["cwd"].exists()
    env = run["env"]
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == TOKEN
    assert env["DISABLE_AUTOUPDATER"] == "1"
    assert "ANTHROPIC_API_KEY" not in env
    assert env["HOME"] != str(run["cwd"])


def test_a_photo_goes_by_its_own_name() -> None:
    reader, fake = claude(answer(READ), answer(READ))

    reader.read(b"png", "image/png")
    reader.read(b"jpg", "image/jpeg")

    assert [r["files"] for r in fake.runs] == [{"receipt.png": b"png"}, {"receipt.jpg": b"jpg"}]


def test_what_does_not_parse_is_left_out_and_no_receipt_says_so() -> None:
    odd = {**READ, "date": "1st of October", "total": "-5", "form_line": "lottery"}

    assert reading(odd) == {
        "date": None,
        "amount": None,
        "payee": "Malerbetrieb Huber",
        "labour": "300.00",
        "form_line": None,
    }
    assert "error" in reading({**READ, "is_receipt": False})


def test_a_decline_and_three_unusable_replies_end_as_readings_never_sent_again() -> None:
    unread = [{"id": n, "media_type": "application/pdf"} for n in (1, 2, 3)]
    kasten = FakeKasten(unread=unread)
    reader, fake = claude(
        answer(None, "refusal"),
        answer(None),  # A result with no structured output.
        answer(None),
        answer(None),
        answer(None),
        answer(READ),
    )

    counts = receipts.read_all(kasten.api(), reader)
    again = receipts.read_all(kasten.api(), reader)

    assert counts == {"read": 1, "unreadable": 2, "skipped": 0, "stopped": 0}
    assert kasten.readings[1] == {"error": "The model declined to read this file"}
    assert kasten.readings[2] == {"error": "No usable answer in 3 tries"}
    # 3: one result without the schema's JSON, then an answer, in the same run.
    assert kasten.readings[3]["amount"] == "476.00"
    assert len(fake.runs) == 6
    assert again == {"read": 0, "unreadable": 0, "skipped": 0, "stopped": 0}
    assert not receipts.failed(counts)


def test_a_file_the_api_refuses_is_done_and_a_busy_api_stops_the_run() -> None:
    kasten = FakeKasten(
        unread=[{"id": n, "media_type": "application/pdf"} for n in (1, 2, 3)], gone={1}
    )
    reader, _ = claude(
        failure(413, "API Error: 413 too large"), failure(429, "Claude usage limit reached")
    )

    counts = receipts.read_all(kasten.api(), reader)

    # 1: its file is gone; 2: the API refused the file; 3: the limit was reached.
    assert counts == {"read": 0, "unreadable": 1, "skipped": 1, "stopped": 1}
    assert kasten.readings == {
        2: {"error": "The reader could not take this file: API Error: 413 too large"}
    }
    assert 3 not in kasten.readings
    assert receipts.failed(counts)


def test_a_hung_claude_code_no_network_and_the_usage_limit_stop_the_run() -> None:
    for reply in (
        subprocess.TimeoutExpired,
        failure(None, "Connection error"),
        failure(None, "Usage limit reached") | {"terminal_reason": "blocking_limit"},
        failure(None, "Something odd") | {"terminal_reason": "completed"},
    ):
        kasten = FakeKasten(unread=[{"id": 1, "media_type": "application/pdf"}])
        reader, _ = claude(reply)

        counts = receipts.read_all(kasten.api(), reader)

        assert counts["stopped"] == 1
        assert kasten.readings == {}


def test_a_missing_or_bad_token_or_model_fails_the_run_loudly() -> None:
    for reply in (
        failure(None, "Not logged in · Please run /login"),
        failure(401, "Failed to authenticate. API Error: 401 OAuth access token is invalid."),
        failure(404, "There's an issue with the selected model (claude-bogus-9)."),
        failure(400, "claude_code_version_too_old"),
        failure(400, "The model is not on your plan"),
        "",  # Claude Code died before it printed anything.
        "error: unknown option '--effort'",
    ):
        kasten = FakeKasten(unread=[{"id": 1, "media_type": "application/pdf"}])
        reader, _ = claude(reply)

        with pytest.raises(SetupError):
            receipts.read_all(kasten.api(), reader)
        assert kasten.readings == {}


def test_a_file_too_big_or_unreadable_is_done_at_once() -> None:
    for reply in (
        failure(413, "Request too large"),
        failure(None, "Could not process image") | {"terminal_reason": "image_error"},
        failure(None, "Prompt is too long") | {"terminal_reason": "prompt_too_long"},
    ):
        kasten = FakeKasten(unread=[{"id": 1, "media_type": "application/pdf"}])
        reader, fake = claude(reply)

        counts = receipts.read_all(kasten.api(), reader)

        assert counts == {"read": 0, "unreadable": 1, "skipped": 0, "stopped": 0}
        assert kasten.readings[1]["error"].startswith("The reader could not take this file: ")
        assert len(fake.runs) == 1


def test_three_receipts_in_a_row_with_no_answer_stop_the_run() -> None:
    kasten = FakeKasten(unread=[{"id": n, "media_type": "application/pdf"} for n in (1, 2, 3, 4)])
    reader, fake = claude(*[answer(None)] * 9)

    counts = receipts.read_all(kasten.api(), reader)

    assert counts == {"read": 0, "unreadable": 2, "skipped": 0, "stopped": 1}
    # The third stays unread, and the fourth is never tried.
    assert set(kasten.readings) == {1, 2}
    assert len(fake.runs) == 9
    assert receipts.failed(counts)


def test_the_token_never_shows_in_a_repr() -> None:
    reader, _ = claude()
    settings = receipts.Settings.from_env({"CLAUDE_CODE_OAUTH_TOKEN": TOKEN})

    assert TOKEN not in repr(reader)
    assert TOKEN not in repr(settings)


def test_read_without_a_token_fails_before_it_calls_anything(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    monkeypatch.setenv("KASTEN_API", "http://kasten.invalid")

    assert receipts.main(["read"]) == 1


def test_only_a_stopped_run_fails() -> None:
    assert not receipts.failed({"read": 0, "unreadable": 4, "skipped": 2, "stopped": 0})
    assert receipts.failed({"read": 5, "unreadable": 0, "skipped": 0, "stopped": 1})


class FixedReader:
    """A reader whose model always reads the same total, counting its calls."""

    def __init__(self, total: str) -> None:
        self.calls = 0
        self.total = total

    def read(self, data: bytes, media_type: str) -> dict[str, Any]:
        self.calls += 1
        return reading({**READ, "total": self.total})


class HugeReader:
    """A reader that sends an amount no `numeric(14,2)` holds, as an older reader could."""

    def read(self, data: bytes, media_type: str) -> dict[str, Any]:
        return {"amount": "1234567890123456.00"}


def kasten_refusing_long_amounts() -> tuple[KastenApi, dict[int, dict[str, Any]]]:
    """One unread receipt; kasten refuses an amount of more than 14 digits, as `numeric(14,2)`."""
    readings: dict[int, dict[str, Any]] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == "/api/finance/receipts":
            after = int(request.url.params.get("after", "0"))
            done = after >= 1 or 1 in readings
            return httpx.Response(200, json=[] if done else [{"id": 1, "media_type": "image/png"}])
        if request.url.path.endswith("/file"):
            return httpx.Response(200, content=PDF)
        body = json.loads(request.content)
        if len((body.get("amount") or "").replace(".", "")) > 14:
            return httpx.Response(422, json={"detail": "too many digits"})
        readings[1] = body
        return httpx.Response(200, json={"id": 1})

    client = httpx.Client(base_url="http://kasten", transport=httpx.MockTransport(handle))
    return KastenApi(client), readings


def test_nan_infinity_and_huge_totals_read_as_none() -> None:
    for total in ("NaN", "Infinity", "-inf", "1000000000000", "1234567890123456"):
        assert reading({**READ, "total": total})["amount"] is None, total
    assert reading({**READ, "total": "999999999999.99"})["amount"] == "999999999999.99"


def test_a_reading_kasten_refuses_is_stored_as_an_error_and_never_read_again() -> None:
    api, readings = kasten_refusing_long_amounts()
    reader = FixedReader("476.00")
    huge = HugeReader()

    first = receipts.read_all(api, huge)
    later = [receipts.read_all(api, reader) for _ in range(2)]

    assert readings[1]["error"].startswith("kasten refused the reading: ")
    assert first["unreadable"] == 1
    assert reader.calls == 0
    assert all(not receipts.failed(c) for c in [first, *later])


def test_a_nan_total_does_not_stop_the_run() -> None:
    api, readings = kasten_refusing_long_amounts()
    reader = FixedReader("NaN")

    counts = receipts.read_all(api, reader)

    assert reader.calls == 1
    assert readings[1]["amount"] is None
    assert counts["read"] == 1
