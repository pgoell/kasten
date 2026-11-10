"""The test push: one device's message sent now, and what its push service answered."""

from typing import TYPE_CHECKING

import httpx
import pytest

from backend.tests.push.conftest import PushService, subscribe
from kasten_backend.main import app
from kasten_backend.push import push_client

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from kasten_backend.config import Settings


@pytest.fixture
async def service() -> AsyncIterator[PushService]:
    """A fake push service the test push goes out to."""
    fake = PushService()
    async with fake.client() as http:
        app.dependency_overrides[push_client] = lambda: http
        yield fake
    app.dependency_overrides.pop(push_client)


async def test_a_test_push_reaches_only_that_device(
    client: httpx.AsyncClient, served: Settings, service: PushService
) -> None:
    phone, _ = await subscribe(client, service, "phone", "laptop")
    answer = await client.post(f"/api/push/devices/{phone}/test")
    assert answer.json() == {"status": 201, "reason": None, "gone": False}
    [(endpoint, message)] = service.sent
    assert endpoint == "https://push.example/phone"
    assert message["tag"] == "test"


async def test_a_refusal_carries_the_push_service_reason(
    client: httpx.AsyncClient, served: Settings, service: PushService
) -> None:
    [phone] = await subscribe(client, service, "phone")

    def refuse(request: httpx.Request) -> httpx.Response:
        service.handle(request)
        return httpx.Response(403, text="BadJwtToken\n")

    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as http:
        app.dependency_overrides[push_client] = lambda: http
        answer = (await client.post(f"/api/push/devices/{phone}/test")).json()
    assert answer == {"status": 403, "reason": "BadJwtToken", "gone": False}
    assert len(service.sent) == 1


async def test_a_gone_device_is_removed(
    client: httpx.AsyncClient, served: Settings, service: PushService
) -> None:
    [phone] = await subscribe(client, service, "phone")
    service.status["https://push.example/phone"] = 410
    answer = (await client.post(f"/api/push/devices/{phone}/test")).json()
    assert answer == {"status": 410, "reason": None, "gone": True}
    assert (await client.get("/api/push")).json()["devices"] == []
    assert (await client.post(f"/api/push/devices/{phone}/test")).status_code == 404
