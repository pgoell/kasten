"""Garmin's Personal API: a personal key traded for an access token, and the activity list.

The routes are in Garmin's swagger at developer.garmin.com/gc-developer-program/personal/.
"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import httpx

BASE = "https://personal.connectapi.garmin.com"
EXCHANGE = "/personalapitoken-service/personal-api/personal-api-key/token"
ACTIVITIES = "/activitylist-service/activities/search/activities"
PAGE = 99
"""The most activities one read answers, Garmin's own default."""


class GarminError(RuntimeError):
    """Garmin answered in a way the sync cannot use."""


class GarminApi:
    """One run's reads, the token fetched once at the first read."""

    def __init__(self, client: httpx.Client, key: str) -> None:
        """Wrap a client whose `base_url` is Garmin's, and the personal key."""
        self.client = client
        self.key = key
        self._token: str | None = None

    def token(self) -> str:
        """The access token the key gives, fetched once."""
        if self._token is None:
            response = self.client.post(EXCHANGE, headers={"Authorization": f"ApiKey {self.key}"})
            response.raise_for_status()
            self._token = token_of(response.json())
        return self._token

    def activities(self, start: str, end: str) -> list[dict[str, Any]]:
        """Every activity that started from `start` to `end`, both `YYYY-MM-DD`, oldest first."""
        found: list[dict[str, Any]] = []
        while True:
            params = {
                "startDate": start,
                "endDate": end,
                "start": len(found),
                "limit": PAGE,
                "sortOrder": "asc",
            }
            headers = {"Authorization": f"Bearer {self.token()}"}
            response = self.client.get(ACTIVITIES, params=params, headers=headers)
            response.raise_for_status()
            page = response.json()
            if not isinstance(page, list):
                raise GarminError("The activity list is not a list")
            found.extend(page)
            if len(page) < PAGE:
                return found


def token_of(answer: Any) -> str:
    """The access token in the token route's answer, under whichever name it carries it."""
    if isinstance(answer, dict):
        for name in ("access_token", "accessToken", "token"):
            value = answer.get(name)
            if isinstance(value, str) and value:
                return value
        # The names alone, never a value: the log must not hold a secret.
        raise GarminError(f"No token in the answer, which holds {sorted(answer)}")
    raise GarminError("The token answer is not an object")
