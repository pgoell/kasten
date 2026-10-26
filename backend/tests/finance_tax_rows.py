"""The marks, receipts and years the tax tests send and read, and small files of each kind."""

from typing import TYPE_CHECKING, Any

from backend.tests.finance_rows import API, stored

if TYPE_CHECKING:
    from httpx import AsyncClient, Response

PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 32
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
RECEIPTS = f"{API}/receipts"


async def ids(client: AsyncClient) -> dict[str, int]:
    """Every booking's id, by source key."""
    return {key: row["id"] for key, row in (await stored(client)).items()}


async def mark(client: AsyncClient, transaction_id: int, line: str, **fields: Any) -> Response:
    """Put a mark on a booking; the answer is the test's to check."""
    body = {"form_line": line, **fields}
    return await client.put(f"{API}/transactions/{transaction_id}/tax-mark", json=body)


async def year(client: AsyncClient, number: int) -> dict[str, Any]:
    response = await client.get(f"{API}/tax/{number}")
    assert response.status_code == 200, response.text
    return response.json()


def totals(summary: dict[str, Any]) -> dict[str, str]:
    """Each line's total, by its key, leaving out the lines with nothing on them."""
    return {line["form_line"]: line["total"] for line in summary["lines"] if line["bookings"]}


async def upload(
    client: AsyncClient,
    data: bytes = PDF,
    name: str = "invoice.pdf",
    **form: Any,
) -> Response:
    """Send a file as the pane does; the answer is the test's to check."""
    files = {"file": (name, data, "application/octet-stream")}
    return await client.post(RECEIPTS, files=files, data={k: str(v) for k, v in form.items()})


async def kept(client: AsyncClient, data: bytes = PDF, **form: Any) -> dict[str, Any]:
    """Send a file and hand back the receipt kept."""
    response = await upload(client, data, **form)
    assert response.status_code == 200, response.text
    return response.json()["receipt"]
