"""The hour-by-hour weather a daily note draws under its title.

Open-Meteo answers it: free, no key, and one request carries every place. The
browser cannot ask it directly, the app's `connect-src 'self'` refusing any other
origin, so the backend asks and hands the day back trimmed to what the card
draws.

Nothing is written. The forecast is read when a note opens, which is why a daily
note older than Open-Meteo's reach shows no card rather than a stale one.
"""

import time
from datetime import date, timedelta

import httpx
from pydantic import BaseModel, ConfigDict

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

PAST_DAYS = 92
"""How far back the forecast endpoint reaches. Open-Meteo's own limit."""

FUTURE_DAYS = 15
"""How far ahead it reaches: sixteen days counting today."""

CACHE_SECONDS = 30 * 60
"""How long one day's answer is kept before Open-Meteo is asked again.

Every daily note that opens asks, and a note is opened many times in a day.
Open-Meteo updates its models hourly, so half an hour loses nothing worth seeing.
"""

TIMEOUT_SECONDS = 10.0


class Place(BaseModel):
    """A town the card draws, by the name it is shown under."""

    # Frozen so a list of them can key the cache.
    model_config = ConfigDict(frozen=True)

    name: str
    latitude: float
    longitude: float


class Hour(BaseModel):
    """One hour of one place's day, local time."""

    time: str
    """`HH:MM`. Spelled out rather than implied by the index, a day that
    changes the clocks being 23 or 25 hours long."""
    temperature: float
    rain_chance: int
    """Percent."""
    rain: float
    """Millimetres."""
    code: int
    """The WMO weather code, which the card turns into an icon."""


class Forecast(BaseModel):
    """One place's day."""

    place: str
    sunrise: str
    sunset: str
    hours: list[Hour]


_cache: dict[tuple[date, tuple[Place, ...]], tuple[float, list[Forecast]]] = {}


def _client() -> httpx.AsyncClient:
    """The client the forecast is asked with, a seam the tests answer through."""
    return httpx.AsyncClient(timeout=TIMEOUT_SECONDS)


def in_reach(day: date, today: date) -> bool:
    """Whether Open-Meteo's forecast endpoint has anything for `day`."""
    return today - timedelta(days=PAST_DAYS) <= day <= today + timedelta(days=FUTURE_DAYS)


async def read_weather(day: date, places: list[Place]) -> list[Forecast]:
    """Every place's weather on `day`, from the cache when it is fresh.

    Raises `httpx.HTTPError` when Open-Meteo cannot be reached or refuses.
    """
    if not places:
        return []
    key = (day, tuple(places))
    held = _cache.get(key)
    if held is not None and time.monotonic() - held[0] < CACHE_SECONDS:
        return held[1]

    params = {
        "latitude": ",".join(str(place.latitude) for place in places),
        "longitude": ",".join(str(place.longitude) for place in places),
        "hourly": "temperature_2m,precipitation_probability,precipitation,weather_code",
        "daily": "sunrise,sunset",
        # Each place in its own zone, so the hours are the ones on its clocks.
        "timezone": "auto",
        "start_date": day.isoformat(),
        "end_date": day.isoformat(),
    }
    async with _client() as client:
        response = await client.get(FORECAST_URL, params=params)
        response.raise_for_status()
    body = response.json()
    # One place is answered with an object, several with a list.
    found = body if isinstance(body, list) else [body]

    forecasts = [_forecast(place, data) for place, data in zip(places, found, strict=True)]
    _cache[key] = (time.monotonic(), forecasts)
    return forecasts


def _forecast(place: Place, data: dict) -> Forecast:
    hourly = data["hourly"]
    daily = data["daily"]
    hours = [
        Hour(
            time=stamp[11:16],
            temperature=temperature,
            rain_chance=chance or 0,
            rain=rain or 0.0,
            code=code or 0,
        )
        for stamp, temperature, chance, rain, code in zip(
            hourly["time"],
            hourly["temperature_2m"],
            hourly["precipitation_probability"],
            hourly["precipitation"],
            hourly["weather_code"],
            strict=True,
        )
        # A gap in the model is a null temperature, and an hour with no
        # temperature has nothing to draw.
        if temperature is not None
    ]
    return Forecast(
        place=place.name,
        sunrise=daily["sunrise"][0][11:16],
        sunset=daily["sunset"][0][11:16],
        hours=hours,
    )
