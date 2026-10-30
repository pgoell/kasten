"""Foods for the log: searched on Open Food Facts, or read by barcode, and trimmed.

Search goes to Search-a-licious: the older `cgi/search.pl` refuses anonymous callers, and the
v2 product API has no full-text search. Answers are held in memory, and that keeps kasten
inside Open Food Facts' rate limits, since a cache hit is not a call.
"""

import math
import re
import time
from collections import deque
from http import HTTPStatus
from importlib.metadata import version
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings

router = APIRouter()

SEARCH_URL = "https://search.openfoodfacts.org/search"
PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
FIELDS = "code,product_name,brands,serving_size,serving_quantity,nutriments"
"""What each answer carries. Asking for these alone keeps the answers small."""
PAGE_SIZE = 20
TIMEOUT_SECONDS = 10.0
RELEASE = version("kasten-backend")
REDIRECTS = range(300, 400)
"""The 3xx answers, which name a product in another OFF database rather than food."""
BARCODE = r"[0-9]{8,14}"
"""A barcode's digits. A search of only these is a barcode read, not a text search."""
UNANSWERED = "Open Food Facts did not answer"
REFUSED = "Open Food Facts refused the request (too many requests or busy); try again in a minute"

SEARCHES_PER_MINUTE = 10
PRODUCT_READS_PER_MINUTE = 15
WINDOW_SECONDS = 60
"""The calls to Open Food Facts allowed in a minute from one IP, and the window they are counted in.

Going past them can get the IP banned. OFF names no separate limit for
Search-a-licious, so searches are held to the search limit.
See https://openfoodfacts.github.io/openfoodfacts-server/api/#rate-limits
"""

SEARCH_CACHE_SECONDS = 24 * 60 * 60
"""A search is kept a day. The same search comes back often, and a catalogue changes slowly."""
BARCODE_CACHE_SECONDS = 3 * 24 * 60 * 60
"""A found barcode is kept three days. A label changes rarely; a read is the tighter limit."""
CACHE_MAX_ENTRIES = 1000
"""The most answers held at once. Past it the oldest is dropped, so memory stays bounded."""
SEARCH_MIN, SEARCH_MAX = 2, 100
"""How many characters `q` may hold once its spaces at the ends are gone."""

NUTRIENTS = {"kcal": "energy-kcal", "protein": "proteins", "carbs": "carbohydrates", "fat": "fat"}
"""Each field the log keeps, and the name OFF gives it before its `_100g` or `_serving`."""
GRAMS = re.compile(r"([0-9]+(?:[.,][0-9]+)?)\s*g\b", re.IGNORECASE)
"""Grams in a serving size, as in `50 g` or `1 bar (52,7 g)`. Millilitres never match."""

ServingFrom = Literal["serving_quantity", "serving_size", "default"]


class Nutrients(BaseModel):
    """What a serving or 100 grams holds: kilocalories, and grams of protein, carbs and fat."""

    kcal: float | None
    protein: float | None
    carbs: float | None
    fat: float | None


class Food(BaseModel):
    """One food: its name, one serving, and its nutrients per 100 g and per serving."""

    code: str
    name: str
    brand: str | None
    serving_g: float
    serving_from: ServingFrom
    """Where `serving_g` came from. `default` means OFF gave no serving: 100 g."""
    per_100g: Nutrients
    per_serving: Nutrients


_cache: dict[tuple[str, str], tuple[float, list[Food]]] = {}
"""Answers by `("search", q)` or `("barcode", code)`, each with the time it was taken."""
_searches: deque[float] = deque()
_reads: deque[float] = deque()
"""The times of the calls made to OFF in the window, one queue for each limit."""


def _client() -> httpx.AsyncClient:
    """The client OFF is asked with, a seam the tests answer through."""
    return httpx.AsyncClient(timeout=TIMEOUT_SECONDS)


def _number(value: object) -> float | None:
    """A number OFF sent, which it may send as text with a comma, or None for anything else."""
    if isinstance(value, str):
        try:
            value = float(value.replace(",", "."))
        except ValueError:
            return None
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


def _text(value: object) -> str | None:
    """The text OFF sent, stripped, or None where it sent none."""
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _brand(value: object) -> str | None:
    """The first brand: a list in search answers, one comma-separated text in v2."""
    if isinstance(value, str):
        pieces = value.split(",")
    elif isinstance(value, list):
        pieces = value
    else:
        return None
    for piece in pieces:
        text = _text(piece)
        if text is not None:
            return text
    return None


def _nutrient(value: object) -> float | None:
    """A nutrient OFF sent. A negative one is no nutrient, so it counts as absent."""
    number = _number(value)
    return number if number is not None and number >= 0 else None


def _serving_size_grams(value: object) -> float | None:
    if not isinstance(value, str):
        return None
    found = GRAMS.search(value)
    if found is None:
        return None
    grams = round(float(found[1].replace(",", ".")), 3)
    return grams if grams > 0 else None


def _serving(item: dict[str, Any]) -> tuple[float, ServingFrom]:
    """The grams one serving weighs, and where that number came from.

    The default of 100 g makes per-100g figures read as per-serving when OFF names no serving.
    """
    quantity = _number(item.get("serving_quantity"))
    if quantity is not None and round(quantity, 3) > 0:
        return round(quantity, 3), "serving_quantity"
    grams = _serving_size_grams(item.get("serving_size"))
    if grams is not None:
        return grams, "serving_size"
    return 100.0, "default"


def _nutrients(values: dict[str, float | None]) -> Nutrients:
    """The nutrients, each rounded to three places.

    The rounding strips float noise OFF's own numbers carry: 0.200000002980232 is 0.2.
    """
    return Nutrients(
        **{name: None if value is None else round(value, 3) for name, value in values.items()}
    )


def _food(code: str, item: dict[str, Any]) -> Food:
    """The food a product or a search hit describes, trimmed to what the log keeps."""
    nutriments = item.get("nutriments")
    if not isinstance(nutriments, dict):
        nutriments = {}
    serving_g, serving_from = _serving(item)

    per_100g: dict[str, float | None] = {
        field: _nutrient(nutriments.get(f"{off}_100g")) for field, off in NUTRIENTS.items()
    }
    per_serving: dict[str, float | None] = {}
    for field, off in NUTRIENTS.items():
        given = _nutrient(nutriments.get(f"{off}_serving"))
        base = per_100g[field]
        # Worked out from 100 g only where OFF gives no figure for the serving itself.
        if given is None and base is not None:
            given = base * serving_g / 100
        per_serving[field] = given

    brand = _brand(item.get("brands"))
    return Food(
        code=code,
        name=_text(item.get("product_name")) or brand or code,
        brand=brand,
        serving_g=serving_g,
        serving_from=serving_from,
        per_100g=_nutrients(per_100g),
        per_serving=_nutrients(per_serving),
    )


def _lifetime(key: tuple[str, str]) -> float:
    """How long an answer under `key` is kept: a search a day, a barcode three days."""
    return SEARCH_CACHE_SECONDS if key[0] == "search" else BARCODE_CACHE_SECONDS


def _held(key: tuple[str, str]) -> list[Food] | None:
    """The answer kept under `key`, or None when none is kept or its time is up."""
    held = _cache.get(key)
    if held is None or time.monotonic() - held[0] >= _lifetime(key):
        return None
    return held[1]


def _store(key: tuple[str, str], foods: list[Food]) -> None:
    """Keep `foods` under `key`, after dropping every answer whose time is up.

    Past CACHE_MAX_ENTRIES the oldest answer goes. The key is removed before it is
    set again, because a dict keeps a reassigned key where it first was.
    """
    now = time.monotonic()
    expired = [old for old, (stored, _) in _cache.items() if now - stored >= _lifetime(old)]
    for old in expired:
        del _cache[old]
    _cache.pop(key, None)
    _cache[key] = (now, foods)
    while len(_cache) > CACHE_MAX_ENTRIES:
        del _cache[next(iter(_cache))]


def _admit(window: deque[float], limit: int, phrase: str) -> None:
    """Count one call to OFF in `window`, or refuse it when the window is full.

    The time is taken before the call is made, so a call that fails still counts:
    OFF counts it too.
    """
    now = time.monotonic()
    while window and now - window[0] >= WINDOW_SECONDS:
        window.popleft()
    if len(window) >= limit:
        wait = math.ceil(WINDOW_SECONDS - (now - window[0]))
        detail = f"Open Food Facts allows {phrase} a minute; try again in {wait} s"
        raise HTTPException(status_code=429, detail=detail)
    window.append(now)


async def _get(url: str, params: dict[str, str], contact: str) -> httpx.Response:
    """Ask OFF, and answer its refusals and its failures the way this API answers them."""
    headers = {"User-Agent": f"kasten/{RELEASE} ({contact})"}
    try:
        async with _client() as client:
            response = await client.get(url, params=params, headers=headers)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=UNANSWERED) from error
    if response.status_code in (429, 503):
        raise HTTPException(status_code=503, detail=REFUSED)
    return response


def _body(response: httpx.Response) -> Any:
    """What OFF sent, parsed. A body that is not JSON is OFF failing, not the caller."""
    try:
        return response.json()
    except ValueError as error:
        # JSONDecodeError, and the decode error of a body that is not text.
        raise HTTPException(status_code=502, detail=UNANSWERED) from error


async def _search(text: str, contact: str) -> list[Food]:
    response = await _get(
        SEARCH_URL, {"q": text, "page_size": str(PAGE_SIZE), "fields": FIELDS}, contact
    )
    if not response.is_success:
        raise HTTPException(status_code=502, detail=UNANSWERED)
    body = _body(response)
    hits = body.get("hits") if isinstance(body, dict) else None
    if not isinstance(hits, list) or not all(isinstance(hit, dict) for hit in hits):
        raise HTTPException(status_code=502, detail=UNANSWERED)
    foods = []
    for hit in hits:
        # A hit with no code names no product, so it is not a food the log can keep.
        code = _text(hit.get("code"))
        if code is not None:
            foods.append(_food(code, hit))
    return foods


async def _product(code: str, contact: str) -> Food | None:
    """The food with barcode `code`: from the cache or OFF, or None when OFF has no such product."""
    held = _held(("barcode", code))
    if held is not None:
        return held[0]

    _admit(_reads, PRODUCT_READS_PER_MINUTE, f"{PRODUCT_READS_PER_MINUTE} product reads")
    response = await _get(PRODUCT_URL.format(code=code), {"fields": FIELDS}, contact)
    # A redirect means the product sits in another OFF database, which is not food.
    # Redirects are not followed, so a 3xx comes back here as it was sent.
    if response.status_code == HTTPStatus.NOT_FOUND or response.status_code in REDIRECTS:
        return None
    if not response.is_success:
        raise HTTPException(status_code=502, detail=UNANSWERED)
    body = _body(response)
    if not isinstance(body, dict):
        raise HTTPException(status_code=502, detail=UNANSWERED)
    if body.get("status") == 0:
        return None
    product = body.get("product")
    if not isinstance(product, dict):
        raise HTTPException(status_code=502, detail=UNANSWERED)

    food = _food(_text(product.get("code")) or code, product)
    _store(("barcode", code), [food])
    return food


@router.get("/api/food/search")
async def search_food(q: str, settings: Annotated[Settings, Depends(get_settings)]) -> list[Food]:
    """The foods whose name matches `q` on Open Food Facts.

    A `q` of only 8 to 14 digits is a barcode, and answers the one food it names,
    or none.
    """
    text = q.strip()
    if not SEARCH_MIN <= len(text) <= SEARCH_MAX:
        detail = f"`q` must be {SEARCH_MIN} to {SEARCH_MAX} characters"
        raise HTTPException(status_code=422, detail=detail)
    if re.fullmatch(BARCODE, text):
        food = await _product(text, settings.food_contact)
        return [] if food is None else [food]

    key = ("search", text.lower())
    held = _held(key)
    if held is not None:
        return held
    _admit(_searches, SEARCHES_PER_MINUTE, f"{SEARCHES_PER_MINUTE} searches")
    foods = await _search(text, settings.food_contact)
    _store(key, foods)
    return foods


@router.get("/api/food/barcode/{code}")
async def read_barcode(
    code: Annotated[str, Path(pattern=f"^{BARCODE}$")],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Food:
    """The food with barcode `code`, as Open Food Facts has it."""
    food = await _product(code, settings.food_contact)
    if food is None:
        detail = f"No food with barcode {code} on Open Food Facts"
        raise HTTPException(status_code=404, detail=detail)
    return food
