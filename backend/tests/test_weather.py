"""The day's weather a daily note draws, read off Open-Meteo.

`httpx.MockTransport` answers in Open-Meteo's place, so what is tested is the
trimming and the refusals rather than somebody else's forecast.
"""

from datetime import date, timedelta
from typing import TYPE_CHECKING

import httpx
import pytest

from kasten_backend import weather

if TYPE_CHECKING:
    from collections.abc import Callable

    from httpx import AsyncClient


def place(day: str, sunrise: str, temperatures: list[float | None]) -> dict:
    """One place the way Open-Meteo answers for it, one hour per temperature."""
    count = len(temperatures)
    return {
        "hourly": {
            "time": [f"{day}T{hour:02d}:00" for hour in range(count)],
            "temperature_2m": temperatures,
            "precipitation_probability": [40] * count,
            "precipitation": [0.5] * count,
            "weather_code": [61] * count,
        },
        "daily": {"sunrise": [f"{day}T{sunrise}"], "sunset": [f"{day}T18:48"]},
    }


@pytest.fixture(autouse=True)
def fresh_cache() -> None:
    weather._cache.clear()


@pytest.fixture
def answer(monkeypatch: pytest.MonkeyPatch) -> Callable[[Callable], list[httpx.Request]]:
    """Hand back a way to say what Open-Meteo replies, and the requests it got."""

    def use(handler: Callable) -> list[httpx.Request]:
        seen: list[httpx.Request] = []

        def record(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return handler(request)

        transport = httpx.MockTransport(record)
        monkeypatch.setattr(weather, "_client", lambda: httpx.AsyncClient(transport=transport))
        return seen

    return use


async def test_answers_each_place_hour_by_hour(client: AsyncClient, answer: Callable) -> None:
    today = date.today().isoformat()
    seen = answer(
        lambda _: httpx.Response(
            200, json=[place(today, "07:32", [12.5, 13.0]), place(today, "07:34", [11.0, None])]
        )
    )

    response = await client.get("/api/weather", params={"date": today})

    assert response.status_code == 200
    gelnhausen, frankfurt = response.json()
    assert gelnhausen["place"] == "Gelnhausen"
    assert gelnhausen["sunrise"] == "07:32"
    assert gelnhausen["sunset"] == "18:48"
    assert gelnhausen["hours"][1] == {
        "time": "01:00",
        "temperature": 13.0,
        "rain_chance": 40,
        "rain": 0.5,
        "code": 61,
    }
    # The hour the model has no temperature for is left out.
    assert [hour["time"] for hour in frankfurt["hours"]] == ["00:00"]
    assert seen[0].url.params["start_date"] == today
    assert seen[0].url.params["latitude"] == "50.2017,50.1109"


async def test_asks_once_for_a_day_already_read(client: AsyncClient, answer: Callable) -> None:
    today = date.today().isoformat()
    seen = answer(lambda _: httpx.Response(200, json=[place(today, "07:32", [12.0])] * 2))

    await client.get("/api/weather", params={"date": today})
    await client.get("/api/weather", params={"date": today})

    assert len(seen) == 1


async def test_refuses_a_day_out_of_reach(client: AsyncClient, answer: Callable) -> None:
    seen = answer(lambda _: httpx.Response(500))
    old = (date.today() - timedelta(days=weather.PAST_DAYS + 1)).isoformat()

    response = await client.get("/api/weather", params={"date": old})

    assert response.status_code == 404
    assert seen == []


async def test_says_when_open_meteo_fails(client: AsyncClient, answer: Callable) -> None:
    answer(lambda _: httpx.Response(503))

    response = await client.get("/api/weather", params={"date": date.today().isoformat()})

    assert response.status_code == 502
