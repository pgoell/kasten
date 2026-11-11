"""`POST /api/recipes/import`: a recipe page or a caption's schema.org JSON becomes a note.

No request leaves the process: `httpx.MockTransport` stands in for the plain fetch and a fake
session for the browser-shaped one.
"""

import json
from typing import TYPE_CHECKING, Any

import httpx
import pytest
from curl_cffi import CurlOpt

from kasten_backend import files
from kasten_backend.food.recipes import importer

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from httpx import AsyncClient

URL = "https://www.chefkoch.de/rezepte/1170311223132029/Chili-sin-Carne.html"
CHEFKOCH = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "name": "Chili sin Carne",
    "recipeYield": "4 Portionen",
    "totalTime": "PT1H5M",
    "recipeIngredient": ["800.0 g Kidneybohnen", "2 Zwiebel(n)", "Salz &amp; Pfeffer"],
    "recipeInstructions": [
        {"@type": "HowToStep", "name": "Schritt 1", "text": "Zwiebeln würfeln."},
        {"@type": "HowToStep", "text": "Bohnen dazu &amp; 30 Minuten köcheln."},
    ],
}
PAGE = (
    f'<html><head><script type="application/ld+json">{json.dumps(CHEFKOCH)}</script></head></html>'
)
NOTE = """---
type: Recipe
servings: 4
time: 65 min
source: "https://www.chefkoch.de/rezepte/1170311223132029/Chili-sin-Carne.html"
---
# Chili sin Carne

## Zutaten
- 800 g Kidneybohnen
- 2 Zwiebel(n)
- Salz & Pfeffer

## Schritte
1. Zwiebeln würfeln.
2. Bohnen dazu & 30 Minuten köcheln.
"""
# What the model answers for a pasted reel caption.
CAPTION = {
    "name": "Feta-Pasta aus dem Ofen",
    "recipeYield": "2",
    "recipeIngredient": ["200 g Feta", "400 g Kirschtomaten", "250 g Pasta"],
    "recipeInstructions": ["Feta und Tomaten 25 Minuten backen.", "Mit der Pasta mischen."],
}
REEL = "https://www.instagram.com/reel/C0abc/"


@pytest.fixture(autouse=True)
def public(monkeypatch: pytest.MonkeyPatch) -> None:
    async def lookup(_host: str) -> list[str]:
        return ["93.184.215.14"]

    monkeypatch.setattr(files, "_addresses", lookup)


@pytest.fixture
def answer(monkeypatch: pytest.MonkeyPatch) -> Callable[[Callable], None]:
    def use(handler: Callable) -> None:
        monkeypatch.setattr(files, "_PublicTransport", lambda: httpx.MockTransport(handler))

    return use


def test_a_page_becomes_the_note_the_format_names() -> None:
    assert importer.note_text(importer.from_html(PAGE, URL, URL)) == NOTE


def test_a_caption_read_by_the_model_becomes_a_note() -> None:
    text = importer.note_text(importer.from_json(CAPTION, REEL))
    assert "servings: 2\n" in text
    assert f'source: "{REEL}"' in text
    assert "- 400 g Kirschtomaten\n" in text
    assert "2. Mit der Pasta mischen.\n" in text


@pytest.mark.parametrize(
    "data",
    [
        {**CAPTION, "recipeIngredient": []},
        {**CAPTION, "instructions": CAPTION["recipeInstructions"], "recipeInstructions": []},
        {"name": "Nur ein Titel"},
        ["not", "an", "object"],
    ],
)
def test_json_that_is_no_recipe_is_refused(data: object) -> None:
    with pytest.raises(importer.NoRecipeError, match=r"no schema\.org Recipe"):
        importer.from_json(data, None)


def test_a_page_without_a_recipe_says_so() -> None:
    with pytest.raises(importer.NoRecipeError, match="No recipe found"):
        importer.from_html("<html><body>Hallo</body></html>", URL, URL)


def test_the_file_name_drops_what_a_path_cannot_hold() -> None:
    assert importer.file_name('Pasta: "schnell" / einfach #1') == "Pasta schnell einfach 1.md"
    assert importer.file_name("???") == "Rezept.md"


async def test_a_url_is_fetched_and_written(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    answer(lambda _request: httpx.Response(200, text=PAGE, headers={"content-type": "text/html"}))
    response = await client.post("/api/recipes/import", json={"url": URL})
    assert response.status_code == 201
    assert response.json() == {"path": "Rezepte/Chili sin Carne.md", "title": "Chili sin Carne"}
    written = (vault / "Rezepte" / "Chili sin Carne.md").read_text(encoding="utf-8")
    assert "\nid: " in written
    assert written.endswith(NOTE.split("---\n", 2)[2])


async def test_a_taken_name_gets_a_number(client: AsyncClient, vault: Path) -> None:
    body = {"recipe": CAPTION, "source": REEL}
    first = await client.post("/api/recipes/import", json=body)
    second = await client.post("/api/recipes/import", json=body)
    assert first.json()["path"] == "Rezepte/Feta-Pasta aus dem Ofen.md"
    assert second.json()["path"] == "Rezepte/Feta-Pasta aus dem Ofen 2.md"
    assert (vault / "Rezepte" / "Feta-Pasta aus dem Ofen 2.md").exists()


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({}, 422),
        ({"url": URL, "recipe": CAPTION}, 422),
        ({"recipe": {"name": "Leer"}}, 422),
        ({"url": "file:///etc/passwd"}, 400),
    ],
)
async def test_a_request_without_one_recipe_is_refused(
    client: AsyncClient, body: dict[str, Any], status: int
) -> None:
    assert (await client.post("/api/recipes/import", json=body)).status_code == status


class FakeSession:
    """curl_cffi's session, answering from `replies` and keeping the options each hop pinned."""

    replies: list[tuple[int, dict[str, str], bytes]]
    pinned: list[list[str]]

    def __init__(self, *, trust_env: bool, curl_options: dict[CurlOpt, Any]) -> None:
        assert trust_env is False
        FakeSession.pinned.append(curl_options[CurlOpt.RESOLVE])

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def get(self, _url: str, **_: object) -> FakeReply:
        return FakeReply(*FakeSession.replies.pop(0))


class FakeReply:
    """The parts of curl_cffi's response the import reads."""

    def __init__(self, status: int, headers: dict[str, str], content: bytes) -> None:
        self.status_code = status
        self.headers = headers
        self.content = content
        self.charset = "utf-8"
        self.is_redirect = 300 <= status < 400


@pytest.fixture
def browser(monkeypatch: pytest.MonkeyPatch) -> type[FakeSession]:
    FakeSession.replies = []
    FakeSession.pinned = []
    monkeypatch.setattr(importer, "AsyncSession", FakeSession)
    return FakeSession


async def test_a_bot_wall_is_tried_again_as_a_browser(
    client: AsyncClient, answer: Callable, browser: type[FakeSession]
) -> None:
    answer(lambda _request: httpx.Response(403, headers={"cf-mitigated": "challenge"}))
    browser.replies = [
        (301, {"location": "/rezepte/chili"}, b""),
        (200, {}, PAGE.encode()),
    ]
    response = await client.post("/api/recipes/import", json={"url": "https://www.rewe.de/r/1"})
    assert response.status_code == 201
    assert browser.pinned == [["www.rewe.de:443:93.184.215.14"]] * 2


async def test_a_wall_the_browser_cannot_pass_says_to_paste(
    client: AsyncClient, answer: Callable, browser: type[FakeSession]
) -> None:
    answer(lambda _request: httpx.Response(403))
    browser.replies = [(403, {}, b"")]
    response = await client.post("/api/recipes/import", json={"url": "https://www.hellofresh.de/r"})
    assert response.status_code == 502
    assert "paste the recipe" in response.json()["detail"]
