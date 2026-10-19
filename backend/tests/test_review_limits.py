from typing import TYPE_CHECKING

from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_serves_no_review_limit_when_none_is_set(client: AsyncClient, vault: Path) -> None:
    response = await client.get("/api/review/limits")

    assert response.status_code == 200
    assert response.json() == {"new_per_day": None, "reviews_per_day": None}


async def test_serves_the_review_limits_it_was_given(client: AsyncClient, vault: Path) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        vault_path=vault, review_new_per_day=20, review_reviews_per_day=200
    )

    response = await client.get("/api/review/limits")

    assert response.status_code == 200
    assert response.json() == {"new_per_day": 20, "reviews_per_day": 200}
