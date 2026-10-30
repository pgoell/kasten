"""Gmail, read only, over its REST API with the login the gws CLI exported.

The credentials file is what `gws auth export --unmasked` prints. The token
holds whatever scopes its login granted, so the how-to makes a login of its own
with read-only Gmail. The code only reads: it never labels, moves or sends.
"""

import base64
import json
from dataclasses import dataclass
from datetime import date, datetime
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from pathlib import Path

TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105  a URL, not a secret
API = "https://gmail.googleapis.com/gmail/v1/users/me"


class GmailAuthError(RuntimeError):
    """Google refused the refresh token: it was revoked, or the login it came from was redone."""


@dataclass(frozen=True)
class Mail:
    """One message: its id, the day it came (local time), sender, subject and both bodies."""

    id: str
    day: date
    sender: str
    subject: str
    text: str
    html: str


def _bytes(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _decode(data: str) -> str:
    return _bytes(data).decode("utf-8", "replace")


def _bodies(part: dict[str, Any], found: dict[str, str]) -> None:
    """Collect the first text/plain and text/html body under a MIME part."""
    kind = part.get("mimeType", "")
    data = part.get("body", {}).get("data")
    if data and kind in ("text/plain", "text/html") and kind not in found:
        found[kind] = _decode(data)
    for child in part.get("parts", []):
        _bodies(child, found)


def to_mail(message: dict[str, Any]) -> Mail:
    """A message as `messages.get` with `format=full` answers it."""
    payload = message["payload"]
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    found: dict[str, str] = {}
    _bodies(payload, found)
    # Local time, as the TZ of the env file sets it: a mail at 00:30 belongs to that day.
    day = datetime.fromtimestamp(int(message["internalDate"]) / 1000).date()
    return Mail(
        id=message["id"],
        day=day,
        sender=headers.get("from", ""),
        subject=headers.get("subject", ""),
        text=found.get("text/plain", ""),
        html=found.get("text/html", ""),
    )


@dataclass(frozen=True)
class Attachment:
    """A file a message carries: its name and its bytes."""

    name: str
    data: bytes


def _pdf_parts(part: dict[str, Any], found: list[dict[str, Any]]) -> None:
    """Collect every MIME part under `part` that is a PDF file, by its type or its name."""
    name = part.get("filename", "")
    if name and (part.get("mimeType") == "application/pdf" or name.lower().endswith(".pdf")):
        found.append(part)
    for child in part.get("parts", []):
        _pdf_parts(child, found)


class Gmail:
    """The reads the jobs make: a search, one message, and a message's PDF files."""

    def __init__(self, client: httpx.Client, credentials: dict[str, str]) -> None:
        """Wrap a client for Google's hosts and the exported login."""
        self.client = client
        self.credentials = credentials
        self.token: str | None = None

    @classmethod
    def from_file(cls, client: httpx.Client, path: Path) -> Gmail:
        """Read the login `gws auth export --unmasked` wrote."""
        return cls(client, json.loads(path.read_text()))

    def _auth(self) -> dict[str, str]:
        if self.token is None:
            response = self.client.post(
                TOKEN_URL,
                data={
                    "client_id": self.credentials["client_id"],
                    "client_secret": self.credentials["client_secret"],
                    "refresh_token": self.credentials["refresh_token"],
                    "grant_type": "refresh_token",
                },
            )
            if response.status_code in (httpx.codes.BAD_REQUEST, httpx.codes.UNAUTHORIZED):
                msg = f"Google refused the login: {response.text}"
                raise GmailAuthError(msg)
            response.raise_for_status()
            self.token = response.json()["access_token"]
        return {"authorization": f"Bearer {self.token}"}

    def search(self, query: str) -> list[str]:
        """The ids of every message the Gmail search finds, newest first."""
        ids: list[str] = []
        params: dict[str, Any] = {"q": query, "maxResults": 500}
        while True:
            response = self.client.get(f"{API}/messages", params=params, headers=self._auth())
            response.raise_for_status()
            page = response.json()
            ids += [m["id"] for m in page.get("messages", [])]
            if "nextPageToken" not in page:
                return ids
            params["pageToken"] = page["nextPageToken"]

    def message(self, message_id: str) -> Mail:
        """One message with its bodies."""
        response = self.client.get(
            f"{API}/messages/{message_id}", params={"format": "full"}, headers=self._auth()
        )
        response.raise_for_status()
        return to_mail(response.json())

    def pdfs(self, message_id: str) -> list[Attachment]:
        """The PDF files a message carries. Large ones Gmail hands over by their own id."""
        response = self.client.get(
            f"{API}/messages/{message_id}", params={"format": "full"}, headers=self._auth()
        )
        response.raise_for_status()
        parts: list[dict[str, Any]] = []
        _pdf_parts(response.json()["payload"], parts)
        found = []
        for part in parts:
            body = part.get("body", {})
            data = body.get("data")
            if data is None and "attachmentId" in body:
                url = f"{API}/messages/{message_id}/attachments/{body['attachmentId']}"
                fetched = self.client.get(url, headers=self._auth())
                fetched.raise_for_status()
                data = fetched.json()["data"]
            if data:
                found.append(Attachment(part["filename"], _bytes(data)))
        return found
