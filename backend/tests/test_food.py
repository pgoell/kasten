"""The food search and barcode read through `/api/food/`, from recorded Open Food Facts answers.

`httpx.MockTransport` answers in Open Food Facts' place, so what is tested is the
trimming, the limits and the refusals rather than anybody's catalogue. Every test
goes through the endpoints, never the module, so each one fails on a branch without
the route for a reason of its own: a 404, or an assertion reached.
"""

import importlib
import json
import time
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

import httpx
import pytest

if TYPE_CHECKING:
    from collections.abc import Callable

    from httpx import AsyncClient

FIXTURES = Path(__file__).parent / "fixtures" / "off"
FIELDS = "code,product_name,brands,serving_size,serving_quantity,nutriments"
DAY = 24 * 60 * 60
NO_NUTRIENTS = {"kcal": None, "protein": None, "carbs": None, "fat": None}


def fixture(name: str) -> str:
    """A recorded answer as Open Food Facts sent it, unparsed."""
    return (FIXTURES / name).read_text(encoding="utf-8")


def food_module() -> Any:
    """The food module, or None where it does not exist yet, which is main.

    An import at the top would fail every test at collection there, so the tests
    reach the module only through this, and the endpoints answer the rest.
    """
    try:
        return importlib.import_module("kasten_backend.food")
    except ModuleNotFoundError:
        return None


def is_limit_refusal(detail: object, phrase: str) -> bool:
    """Whether `detail` is the refusal for `phrase`, with a whole number of seconds to wait."""
    prefix = f"Open Food Facts allows {phrase} a minute; try again in "
    if not isinstance(detail, str) or not detail.startswith(prefix) or not detail.endswith(" s"):
        return False
    return detail[len(prefix) : -2].isdigit()


def later(monkeypatch: pytest.MonkeyPatch, seconds: float) -> None:
    """Move the food module's clock on by `seconds`, as though that long had passed."""
    food = food_module()
    if food is not None:
        now = time.monotonic()
        monkeypatch.setattr(food, "time", SimpleNamespace(monotonic=lambda: now + seconds))


def off(request: httpx.Request) -> httpx.Response:
    """Answer a search with the Skyr fixture and a barcode read with the Nutella one."""
    if request.url.host == "search.openfoodfacts.org":
        return httpx.Response(200, text=fixture("search-skyr.json"))
    return httpx.Response(200, text=fixture("product-nutella.json"))


def snapshot(root: Path) -> dict[str, tuple[bytes, int]]:
    """Every file under `root` with its bytes and its modification time."""
    return {
        str(path): (path.read_bytes(), path.stat().st_mtime_ns)
        for path in root.rglob("*")
        if path.is_file()
    }


@pytest.fixture(autouse=True)
def fresh_food() -> None:
    """Empty what the food module remembers, so no test sees another's answers or count."""
    food = food_module()
    if food is not None:
        food._cache.clear()
        food._searches.clear()
        food._reads.clear()


@pytest.fixture
def answer(monkeypatch: pytest.MonkeyPatch) -> Callable[[Callable], list[httpx.Request]]:
    """Hand back a way to say what Open Food Facts replies, and the requests it got."""

    def use(handler: Callable) -> list[httpx.Request]:
        seen: list[httpx.Request] = []

        def record(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return handler(request)

        food = food_module()
        if food is not None:
            transport = httpx.MockTransport(record)
            monkeypatch.setattr(food, "_client", lambda: httpx.AsyncClient(transport=transport))
        return seen

    return use


async def test_621_a1_search_answers_trimmed_foods_with_user_agent(
    client: AsyncClient, answer: Callable
) -> None:
    seen = answer(lambda _: httpx.Response(200, text=fixture("search-skyr.json")))

    r = await client.get("/api/food/search", params={"q": "skyr"})

    body = r.json() if r.status_code == 200 else []
    naturel = body[1] if len(body) > 1 else {}
    assert {
        "status": r.status_code,
        "names": [food["name"] for food in body],
        "brands": [food["brand"] for food in body],
        "naturel": {
            "fat": naturel.get("per_100g", {}).get("fat"),
            "serving_g": naturel.get("serving_g"),
            "serving_from": naturel.get("serving_from"),
        },
        "asked": [(req.url.host, req.url.params.get("q")) for req in seen],
        "agent": [
            req.headers.get("user-agent", "").startswith("kasten/")
            and "https://github.com/pgoell/kasten" in req.headers.get("user-agent", "")
            for req in seen
        ],
    } == {
        "status": 200,
        "names": ["Compote", "Skyr naturel", "Skyr Moka"],
        "brands": ["Skyr", "Skyr", "Skyr"],
        "naturel": {"fat": 0.2, "serving_g": 100.0, "serving_from": "default"},
        "asked": [("search.openfoodfacts.org", "skyr")],
        "agent": [True],
    }


async def test_621_a2_barcode_reads_v2_with_fields_only(
    client: AsyncClient, answer: Callable
) -> None:
    seen = answer(lambda _: httpx.Response(200, text=fixture("product-nutella.json")))

    r = await client.get("/api/food/barcode/3017624010701")

    body = r.json() if r.status_code == 200 else {}
    assert {
        "status": r.status_code,
        "name": body.get("name"),
        "brand": body.get("brand"),
        "asked": [(req.url.host, req.url.path, req.url.params.get("fields")) for req in seen],
    } == {
        "status": 200,
        "name": "Nutella",
        "brand": "Ferrero",
        "asked": [("world.openfoodfacts.org", "/api/v2/product/3017624010701.json", FIELDS)],
    }


async def test_621_a2_unknown_barcode_is_404(client: AsyncClient, answer: Callable) -> None:
    answer(lambda _: httpx.Response(200, text=fixture("product-not-found.json")))

    r = await client.get("/api/food/barcode/0000000000017")

    assert {"status": r.status_code, "detail": r.json().get("detail")} == {
        "status": 404,
        "detail": "No food with barcode 0000000000017 on Open Food Facts",
    }


async def test_621_a3_eleventh_search_in_a_minute_is_refused_without_calling_off(
    client: AsyncClient, answer: Callable
) -> None:
    seen = answer(lambda _: httpx.Response(200, text=fixture("search-skyr.json")))

    statuses = []
    for n in range(11):
        r = await client.get("/api/food/search", params={"q": f"yoghurt {n}"})
        statuses.append(r.status_code)

    assert {
        "statuses": statuses,
        "refused": is_limit_refusal(r.json().get("detail"), "10 searches"),
        "asked": len(seen),
    } == {"statuses": [200] * 10 + [429], "refused": True, "asked": 10}


async def test_621_a3_sixteenth_barcode_read_in_a_minute_is_refused_without_calling_off(
    client: AsyncClient, answer: Callable
) -> None:
    seen = answer(lambda _: httpx.Response(200, text=fixture("product-nutella.json")))

    statuses = []
    for n in range(16):
        r = await client.get(f"/api/food/barcode/30000000{n:05d}")
        statuses.append(r.status_code)

    assert {
        "statuses": statuses,
        "refused": is_limit_refusal(r.json().get("detail"), "15 product reads"),
        "asked": len(seen),
    } == {"statuses": [200] * 15 + [429], "refused": True, "asked": 15}


async def test_621_a4_a_search_is_asked_once_within_a_day(
    client: AsyncClient, answer: Callable, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = answer(lambda _: httpx.Response(200, text=fixture("search-skyr.json")))

    first = await client.get("/api/food/search", params={"q": "skyr"})
    second = await client.get("/api/food/search", params={"q": "Skyr"})
    asked_once = len(seen)
    later(monkeypatch, DAY + 1)
    third = await client.get("/api/food/search", params={"q": "skyr"})

    assert {
        "statuses": [first.status_code, second.status_code, third.status_code],
        "asked": [asked_once, len(seen)],
    } == {"statuses": [200, 200, 200], "asked": [1, 2]}


async def test_621_a4_a_barcode_is_asked_once_within_three_days(
    client: AsyncClient, answer: Callable, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = answer(lambda _: httpx.Response(200, text=fixture("product-nutella.json")))

    first = await client.get("/api/food/barcode/3017624010701")
    second = await client.get("/api/food/barcode/3017624010701")
    asked_once = len(seen)
    later(monkeypatch, 3 * DAY + 1)
    third = await client.get("/api/food/barcode/3017624010701")

    assert {
        "statuses": [first.status_code, second.status_code, third.status_code],
        "asked": [asked_once, len(seen)],
    } == {"statuses": [200, 200, 200], "asked": [1, 2]}


async def test_621_a6_off_503_html_answers_503_with_plain_words(
    client: AsyncClient, answer: Callable
) -> None:
    answer(lambda _: httpx.Response(503, text=fixture("search-pl-503.html")))

    r = await client.get("/api/food/search", params={"q": "skyr"})

    assert {"status": r.status_code, "detail": r.json().get("detail")} == {
        "status": 503,
        "detail": (
            "Open Food Facts refused the request (too many requests or busy); try again in a minute"
        ),
    }


async def test_621_a7_serving_from_serving_quantity_and_off_serving_values(
    client: AsyncClient, answer: Callable
) -> None:
    answer(lambda _: httpx.Response(200, text=fixture("product-snickers.json")))

    r = await client.get("/api/food/barcode/5000159461122")

    body = r.json() if r.status_code == 200 else {}
    assert {
        "status": r.status_code,
        "serving_g": body.get("serving_g"),
        "serving_from": body.get("serving_from"),
        "per_serving": body.get("per_serving"),
    } == {
        "status": 200,
        "serving_g": 50.0,
        "serving_from": "serving_quantity",
        "per_serving": {"kcal": 240.0, "protein": 4.3, "carbs": 30.2, "fat": 11.2},
    }


async def test_621_a7_serving_from_serving_size_grams(
    client: AsyncClient, answer: Callable
) -> None:
    product = json.loads(fixture("product-snickers.json"))
    del product["product"]["serving_quantity"]
    product["product"]["serving_size"] = "1 bar (52,7 g)"
    nutriments = product["product"]["nutriments"]
    for key in [key for key in nutriments if key.endswith("_serving")]:
        del nutriments[key]
    answer(lambda _: httpx.Response(200, json=product))

    r = await client.get("/api/food/barcode/5000159461122")

    body = r.json() if r.status_code == 200 else {}
    per_100g = {"kcal": 481, "protein": 8.6, "carbs": 60.5, "fat": 22.5}
    assert {
        "status": r.status_code,
        "serving_g": body.get("serving_g"),
        "serving_from": body.get("serving_from"),
        "per_serving": body.get("per_serving"),
    } == {
        "status": 200,
        "serving_g": 52.7,
        "serving_from": "serving_size",
        "per_serving": {field: round(value * 52.7 / 100, 3) for field, value in per_100g.items()},
    }


async def test_621_a7_serving_defaults_to_100_g(client: AsyncClient, answer: Callable) -> None:
    answer(lambda _: httpx.Response(200, text=fixture("product-nutella.json")))

    r = await client.get("/api/food/barcode/3017624010701")

    body = r.json() if r.status_code == 200 else {}
    assert {
        "status": r.status_code,
        "serving_g": body.get("serving_g"),
        "serving_from": body.get("serving_from"),
        "per_serving": body.get("per_serving"),
        "per_100g": body.get("per_100g"),
    } == {
        "status": 200,
        "serving_g": 100.0,
        "serving_from": "default",
        "per_serving": {"kcal": 539.0, "protein": 6.3, "carbs": 57.5, "fat": 30.9},
        "per_100g": {"kcal": 539.0, "protein": 6.3, "carbs": 57.5, "fat": 30.9},
    }


async def test_621_i3_missing_nutriments_and_name_fall_back(
    client: AsyncClient, answer: Callable
) -> None:
    answer(
        lambda _: httpx.Response(
            200,
            json={
                "hits": [
                    {"code": "1111111111", "brands": ["Acme"]},
                    {"code": "2222222222"},
                ]
            },
        )
    )

    r = await client.get("/api/food/search", params={"q": "acme"})

    body = r.json() if r.status_code == 200 else []
    assert {
        "status": r.status_code,
        "foods": [
            {
                "name": food["name"],
                "brand": food["brand"],
                "per_100g": food["per_100g"],
                "per_serving": food["per_serving"],
            }
            for food in body
        ],
    } == {
        "status": 200,
        "foods": [
            {
                "name": "Acme",
                "brand": "Acme",
                "per_100g": NO_NUTRIENTS,
                "per_serving": NO_NUTRIENTS,
            },
            {
                "name": "2222222222",
                "brand": None,
                "per_100g": NO_NUTRIENTS,
                "per_serving": NO_NUTRIENTS,
            },
        ],
    }


async def test_621_i4_a_digit_query_reads_the_barcode(
    client: AsyncClient, answer: Callable
) -> None:
    seen = answer(lambda _: httpx.Response(200, text=fixture("product-snickers.json")))

    r = await client.get("/api/food/search", params={"q": "5000159461122"})

    names = [food["name"] for food in r.json()] if r.status_code == 200 else None
    assert {
        "status": r.status_code,
        "names": names,
        "asked": [(req.url.host, req.url.path) for req in seen],
    } == {
        "status": 200,
        "names": ["Snickers"],
        "asked": [("world.openfoodfacts.org", "/api/v2/product/5000159461122.json")],
    }


async def test_621_i5_off_non_json_timeout_and_redirect(
    client: AsyncClient, answer: Callable
) -> None:
    answer(
        lambda _: httpx.Response(
            200, text=fixture("search-pl-503.html"), headers={"content-type": "text/html"}
        )
    )
    not_json = await client.get("/api/food/search", params={"q": "skyr"})

    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("Open Food Facts is slow", request=request)

    answer(timeout)
    slow = await client.get("/api/food/search", params={"q": "skyr timeout"})

    answer(
        lambda _: httpx.Response(
            302, headers={"location": "https://world.openfoodfacts.org/product/3017624010701"}
        )
    )
    moved = await client.get("/api/food/barcode/3017624010701")

    assert {
        "not_json": not_json.status_code,
        "slow": slow.status_code,
        "moved": moved.status_code,
    } == {"not_json": 502, "slow": 502, "moved": 404}


async def test_621_a1_short_query_is_422(client: AsyncClient, answer: Callable) -> None:
    answer(lambda _: httpx.Response(200, text=fixture("search-skyr.json")))

    r = await client.get("/api/food/search", params={"q": " s "})

    assert {"status": r.status_code} == {"status": 422}


async def test_621_a13_nothing_is_stored(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    answer(off)
    before = snapshot(vault)

    search = await client.get("/api/food/search", params={"q": "skyr"})
    read = await client.get("/api/food/barcode/3017624010701")

    assert {
        "statuses": [search.status_code, read.status_code],
        "unchanged": snapshot(vault) == before,
    } == {"statuses": [200, 200], "unchanged": True}
