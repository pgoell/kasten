"""The orders the order tests post, the bookings they should match, and the posts themselves.

The order ids, codes, references and names are made up, in the shapes the
mails and the banks write.
"""

from typing import TYPE_CHECKING, Any

from backend.tests.finance_rows import API, booking

if TYPE_CHECKING:
    from httpx import AsyncClient

ORDERS = f"{API}/orders"
# The shapes the banks write, with made-up references.
PAYPAL_PURPOSE = (
    "1059876543210/PP.4711.PP/. Example Shop GmbH, Ihr Einkauf bei Example Shop GmbH"
    " FOLGELASTSCHRIFT"
)
PAYPAL_REFUND = (
    ". Example Shop GmbH, Ihr Einkauf bei Example Shop GmbH/ABBUCHUNG VOM PAYPAL-KONTO"
    " GUTSCHR. UEBERWEISUNG"
)
AMAZON_ID = "123-4567890-1234567"


def amazon_purpose(order_id: str = AMAZON_ID, ref: str = "5ABC4DEF5GHI6JKL") -> str:
    return f"{order_id} AMZNMktp DE {ref} FOLGELASTSCHRIFT"


def item(text: str, amount: str) -> dict[str, str]:
    return {"text": text, "amount": amount}


def charge(key: str, amount: str, items: list[dict[str, str]], day: str = "2026-10-17") -> dict:
    return {"kind": "charge", "key": key, "charged_on": day, "amount": amount, "items": items}


def refund(key: str, amount: str, day: str = "2026-10-22") -> dict[str, str]:
    return {"kind": "refund", "key": key, "charged_on": day, "amount": amount}


def paypal(code: str = "1AB23456CD789012E", **fields: Any) -> dict[str, Any]:
    """A PayPal payment of 30.00 at Example Shop for a book and a mug."""
    return {
        "source": "paypal",
        "order_key": code,
        "ordered_on": "2026-10-17",
        "merchant": "Example Shop GmbH",
        "total": "30.00",
        "charges": [
            charge("payment", "30.00", [item("Garden book", "18.50"), item("Blue mug", "11.50")])
        ],
        **fields,
    }


def amazon(order_id: str = "123-4567890-1234567", **fields: Any) -> dict[str, Any]:
    """An Amazon order of 40.00, sent in two shipments of 25.00 and 15.00."""
    return {
        "source": "amazon",
        "order_key": order_id,
        "ordered_on": "2026-10-15",
        "merchant": "Amazon",
        "total": "40.00",
        "charges": [
            charge("ship-a", "25.00", [item("Lamp", "25.00")], day="2026-10-16"),
            charge(
                "ship-b",
                "15.00",
                [item("2 x Light bulb", "12.00"), item("Cable", "3.00")],
                day="2026-10-18",
            ),
        ],
        **fields,
    }


def paypal_booking(giro: int, key: str, amount: str = "-30.00", **fields: Any) -> dict:
    return booking(
        giro,
        key,
        amount,
        **{
            "booking_date": "2026-10-19",
            "purpose": PAYPAL_PURPOSE,
            "counterparty_name": "PayPal Europe S.a.r.l. et Cie S.C.A",
            **fields,
        },
    )


def amazon_booking(giro: int, key: str, amount: str, day: str, purpose: str = "") -> dict:
    return booking(
        giro,
        key,
        amount,
        booking_date=day,
        purpose=purpose or amazon_purpose(),
        counterparty_name="AMAZON PAYMENTS EUROPE S.C.A.",
    )


async def send(client: AsyncClient, orders: list[dict[str, Any]]) -> dict[str, int]:
    response = await client.post(ORDERS, json=orders)
    assert response.status_code == 200, response.text
    return response.json()


async def unmatched(client: AsyncClient) -> list[dict[str, Any]]:
    response = await client.get(f"{ORDERS}/unmatched")
    assert response.status_code == 200, response.text
    return response.json()


def statuses(orders: list[dict[str, Any]]) -> dict[str, str]:
    return {c["key"]: c["status"] for o in orders for c in o["charges"]}


def parts(row: dict[str, Any]) -> list[tuple[str, str | None]]:
    return [(s["amount"], s["text"]) for s in row["splits"]]
