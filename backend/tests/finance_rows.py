"""The accounts and bookings the finance tests post, and the post itself.

Every finance test goes through the routes, so these build the JSON a job
would send. The IBANs are valid-looking and belong to nobody.
"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from httpx import AsyncClient

GIRO = "DE02120300000000202051"
SAVING = "DE02500105170137075030"
STRANGER = "DE89370400440532013000"


async def account(client: AsyncClient, name: str, iban: str | None = None) -> int:
    """Upsert an account by name and hand back its id."""
    response = await client.post(
        "/api/finance/accounts", json={"name": name, "bank": "DKB", "iban": iban, "kind": "giro"}
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def booking(account_id: int, key: str, amount: str = "-4.20", **fields: Any) -> dict[str, Any]:
    """One booking as a job sends it, on 2026-10-20 unless `fields` says otherwise."""
    return {
        "account_id": account_id,
        "booking_date": "2026-10-20",
        "amount": amount,
        "purpose": "Bäckerei",
        "source_key": key,
        **fields,
    }


async def post(client: AsyncClient, bookings: list[dict[str, Any]]) -> dict[str, int]:
    """Post a batch of bookings and hand back what it did."""
    response = await client.post("/api/finance/transactions", json=bookings)
    assert response.status_code == 200, response.text
    return response.json()


async def groups(client: AsyncClient) -> dict[str, str | None]:
    """Every stored booking's transfer group, by source key."""
    rows = (await client.get("/api/finance/transactions")).json()
    return {row["source_key"]: row["transfer_group"] for row in rows}
