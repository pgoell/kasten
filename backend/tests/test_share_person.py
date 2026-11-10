"""Who a shared-list write is for: the proxy's address, mapped by the settings, named in jj."""

from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError

from backend.tests.conftest import descriptions
from kasten_backend import vcs
from kasten_backend.config import Settings, get_settings

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from httpx import AsyncClient

PEOPLE = (
    '{"Pascal@Example.test": "Pascal", "alicia@example.test": "Alicia",'
    ' "pascal-two@example.test": "Pascal"}'
)
"""Two addresses for Pascal, one mixed-case, and Alicia; read from the environment."""

PASCAL = {"X-Auth-Request-Email": "pascal@example.test"}
ALICIA = {"X-Auth-Request-Email": "ALICIA@example.test"}
STRANGER = {"X-Auth-Request-Email": "bob@example.test"}


@pytest.fixture
def people(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """The people setting, read from the environment the way production reads it."""
    monkeypatch.setenv("KASTEN_SHARE_PEOPLE", PEOPLE)
    get_settings.cache_clear()

    yield

    get_settings.cache_clear()


@pytest.fixture
def folder(versioned_agent_vault: Path) -> Path:
    """The share folder, empty, in a versioned agent vault."""
    path = versioned_agent_vault / "05 Shared"
    path.mkdir()
    return path


@pytest.mark.usefixtures("people")
async def test_810_a9_me_names_the_listed_address_and_the_people_in_order(
    client: AsyncClient,
) -> None:
    response = await client.get("/share/me", headers=PASCAL)

    assert response.json() == {"me": "Pascal", "people": ["Pascal", "Alicia"]}


@pytest.mark.usefixtures("people")
async def test_810_a9_me_matches_the_address_whatever_its_case(client: AsyncClient) -> None:
    response = await client.get("/share/me", headers=ALICIA)

    assert response.json().get("me") == "Alicia"


@pytest.mark.usefixtures("people")
async def test_810_a9_me_is_null_for_an_address_not_listed_or_no_header(
    client: AsyncClient,
) -> None:
    stranger = await client.get("/share/me", headers=STRANGER)
    nobody = await client.get("/share/me")

    assert stranger.json() == {"me": None, "people": ["Pascal", "Alicia"]}
    assert nobody.json() == {"me": None, "people": ["Pascal", "Alicia"]}


@pytest.fixture
def owner(monkeypatch: pytest.MonkeyPatch, people: None) -> None:
    """Pascal owns kasten, which answers on its own host."""
    monkeypatch.setenv("KASTEN_SHARE_OWNER", "Pascal")
    monkeypatch.setenv("KASTEN_AGENT_HOST", "kasten.example.test")
    get_settings.cache_clear()


@pytest.mark.usefixtures("owner")
async def test_me_gives_the_owner_the_way_back_to_kasten(client: AsyncClient) -> None:
    response = await client.get("/share/me", headers=PASCAL)

    assert response.json()["home"] == "https://kasten.example.test/"


@pytest.mark.usefixtures("owner")
async def test_me_gives_nobody_else_the_way_back(client: AsyncClient) -> None:
    alicia = await client.get("/share/me", headers=ALICIA)
    nobody = await client.get("/share/me")

    assert "home" not in alicia.json()
    assert "home" not in nobody.json()


@pytest.mark.usefixtures("people")
async def test_810_a9_a_write_names_the_listed_person_in_the_history(
    client: AsyncClient, folder: Path
) -> None:
    response = await client.post(
        "/share/lists/Einkauf/items", json={"text": "Milch"}, headers=PASCAL
    )

    assert (folder / "Einkauf.md").is_file()
    assert response.status_code == 200
    assert "agent(share:Pascal): 05 Shared/Einkauf.md" in descriptions(folder.parent)


@pytest.mark.usefixtures("people")
async def test_810_a9_a_write_by_an_unlisted_address_stays_share(
    client: AsyncClient, folder: Path
) -> None:
    response = await client.post(
        "/share/lists/Einkauf/items", json={"text": "Milch"}, headers=STRANGER
    )

    assert (folder / "Einkauf.md").is_file()
    assert response.status_code == 200
    assert "agent(share): 05 Shared/Einkauf.md" in descriptions(folder.parent)


@pytest.mark.usefixtures("people")
async def test_810_a9_the_name_does_not_outlive_the_request(client: AsyncClient) -> None:
    await client.get("/share/me", headers=PASCAL)

    assert vcs.writer.get() is None


def test_an_owner_who_is_not_one_of_the_people_is_refused() -> None:
    with pytest.raises(ValidationError, match="KASTEN_SHARE_OWNER"):
        Settings(share_people={"pascal@example.test": "Pascal"}, share_owner="pascal")
