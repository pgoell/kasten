"""The receipt job: PDFs from the labelled mails to kasten, and each unread receipt read by Claude.

Against a fake mailbox, a fake kasten that keeps receipts by their bytes,
and the Anthropic SDK on a mock transport, so no request leaves the box.
"""

import base64
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

import anthropic
import httpx
import httpx2

from kasten_jobs import receipts
from kasten_jobs.gmail import Attachment, Gmail
from kasten_jobs.kasten_api import KastenApi
from kasten_jobs.receipt_reader import ClaudeReader, reading

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


def answer(text: str, stop: str = "end_turn") -> dict[str, Any]:
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
    }


def claude(respond: Any, sent: list[dict[str, Any]]) -> ClaudeReader:
    """A reader whose SDK answers from `respond` (status and JSON) and keeps each body sent."""

    def handle(request: httpx2.Request) -> httpx2.Response:
        sent.append(json.loads(request.content))
        status, body = respond()
        return httpx2.Response(status, json=body)

    client = anthropic.Anthropic(
        api_key="test",
        http_client=httpx2.Client(transport=httpx2.MockTransport(handle)),
        max_retries=0,
    )
    return ClaudeReader(client)


READ = {
    "is_receipt": True,
    "date": "2026-10-01",
    "total": "476,00 €",
    "payee": "Malerbetrieb Huber",
    "labour": "300",
    "form_line": "handwerker",
}


def test_a_receipt_goes_to_claude_whole_and_comes_back_as_a_reading() -> None:
    sent: list[dict[str, Any]] = []
    reader = claude(lambda: (200, answer(json.dumps(READ))), sent)

    found = reader.read(PDF, "application/pdf")

    assert found == {
        "date": "2026-10-01",
        "amount": "476.00",
        "payee": "Malerbetrieb Huber",
        "labour": "300.00",
        "form_line": "handwerker",
    }
    [body] = sent
    assert body["model"] == "claude-sonnet-5-5"
    assert body["fallbacks"] == "default"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in body
    document = body["messages"][0]["content"][0]
    assert document["type"] == "document"
    assert base64.b64decode(document["source"]["data"]) == PDF


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


def test_a_decline_and_three_cut_off_replies_end_as_readings_never_sent_again() -> None:
    unread = [{"id": n, "media_type": "application/pdf"} for n in (1, 2, 3)]
    kasten = FakeKasten(unread=unread)
    cut = answer('{"is_', "max_tokens")
    replies = iter([answer("", "refusal"), cut, cut, cut, cut, answer(json.dumps(READ))])
    sent: list[dict[str, Any]] = []
    reader = claude(lambda: (200, next(replies)), sent)

    counts = receipts.read_all(kasten.api(), reader)
    again = receipts.read_all(kasten.api(), reader)

    assert counts == {"read": 1, "unreadable": 2, "skipped": 0, "stopped": 0}
    assert kasten.readings[1] == {"error": "The model declined to read this file"}
    assert kasten.readings[2] == {"error": "No usable answer in 3 tries"}
    # 3: one cut-off, then an answer, in the same run.
    assert kasten.readings[3]["amount"] == "476.00"
    assert len(sent) == 6
    assert again == {"read": 0, "unreadable": 0, "skipped": 0, "stopped": 0}
    assert not receipts.failed(counts)


def test_a_file_the_api_refuses_is_done_and_a_busy_api_stops_the_run() -> None:
    kasten = FakeKasten(
        unread=[{"id": n, "media_type": "application/pdf"} for n in (1, 2, 3)], gone={1}
    )
    bad = {"type": "error", "error": {"type": "invalid_request_error", "message": "bad pdf"}}
    busy = {"type": "error", "error": {"type": "overloaded_error", "message": "busy"}}
    replies = iter([(400, bad), (529, busy)])
    reader = claude(lambda: next(replies), [])

    counts = receipts.read_all(kasten.api(), reader)

    # 1: its file is gone; 2: the API refused the file; 3: the API was busy.
    assert counts == {"read": 0, "unreadable": 1, "skipped": 1, "stopped": 1}
    assert kasten.readings == {2: {"error": "The reader could not take this file: bad pdf"}}
    assert 3 not in kasten.readings
    assert receipts.failed(counts)


def test_only_a_stopped_run_fails() -> None:
    assert not receipts.failed({"read": 0, "unreadable": 4, "skipped": 2, "stopped": 0})
    assert receipts.failed({"read": 5, "unreadable": 0, "skipped": 0, "stopped": 1})
