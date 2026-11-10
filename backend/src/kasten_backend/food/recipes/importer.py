"""A recipe page, or schema.org Recipe JSON, read into a recipe note (#1725).

Both go through recipe-scrapers and one normaliser, so a pasted caption the model turned into
JSON comes out the way a Chefkoch page does. The format is `docs/reference/food/recipe-note.md`.
"""

import html as entities
import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
from curl_cffi import CurlOpt
from curl_cffi.requests import AsyncSession, RequestsError
from pydantic import BaseModel, Field, ValidationError
from recipe_scrapers import scrape_html
from recipe_scrapers._exceptions import RecipeScrapersExceptions

from kasten_backend import files
from kasten_backend.files import PAGE_FAILED, RefusedError

PAGE_LIMIT_BYTES = 8 * 1024 * 1024
# A bot wall answers one of these; the browser-shaped second try is for them alone.
WALLED = {403, 429, 503}
STEP_NAME = re.compile(r"^(?:schritt|step)\s*\d+\s*:?$", re.IGNORECASE)
WHOLE_FLOAT = re.compile(r"\b(\d+)\.0\b")
SERVINGS = re.compile(r"\d+")
NOT_IN_NAME = re.compile(r'[\\/:*?"<>|#^\[\]]+')


class NoRecipeError(Exception):
    """A page or JSON that holds no recipe this can read; the message says why."""


@dataclass
class Imported:
    """A recipe as the note will hold it."""

    title: str
    servings: int | None
    minutes: int | None
    source: str | None
    groups: list[tuple[str | None, list[str]]]
    steps: list[str]


class HowToStep(BaseModel):
    """One step as schema.org writes it."""

    text: str = Field(min_length=1)


class RecipeJson(BaseModel):
    """The schema.org Recipe the model answers for a caption, checked strictly before use."""

    name: str = Field(min_length=1)
    recipeIngredient: list[str] = Field(min_length=1)  # noqa: N815  schema.org's spelling
    recipeInstructions: list[str | HowToStep] = Field(min_length=1)  # noqa: N815
    recipeYield: str | int | None = None  # noqa: N815
    totalTime: str | None = None  # noqa: N815


def _line(text: str) -> str:
    """One ingredient or step, entities decoded, `800.0 g` written `800 g`, spaces folded."""
    return WHOLE_FLOAT.sub(r"\1", " ".join(entities.unescape(text).split()))


def _optional[T](read: Any, default: T) -> T:
    try:
        return read()
    except RecipeScrapersExceptions, NotImplementedError, ValueError, TypeError:
        return default


def from_html(page: str, url: str, source: str | None) -> Imported:
    """The recipe in a page's schema.org data, or `NoRecipeError` when it holds none."""
    try:
        scraper = scrape_html(page, url, supported_only=False)
        title = _line(scraper.title())
        lines = [_line(each) for each in scraper.ingredients()]
    except (RecipeScrapersExceptions, NotImplementedError, ValueError, TypeError) as error:
        raise NoRecipeError("No recipe found on that page") from error
    groups = _optional(scraper.ingredient_groups, [])
    named = [
        (group.purpose and _line(group.purpose), [_line(each) for each in group.ingredients])
        for group in groups
    ]
    steps = [_line(step) for step in _optional(scraper.instructions_list, [])]
    servings = SERVINGS.search(str(_optional(scraper.yields, "")))
    minutes = _optional(scraper.total_time, None)
    if not title or not lines:
        raise NoRecipeError("That recipe has no title or no ingredients")
    return Imported(
        title=title,
        servings=int(servings[0]) if servings and int(servings[0]) > 0 else None,
        minutes=minutes if isinstance(minutes, int) and minutes > 0 else None,
        source=source,
        groups=named if len(named) > 1 else [(None, lines)],
        steps=[step for step in steps if step and not STEP_NAME.match(step)],
    )


def from_json(data: object, source: str | None) -> Imported:
    """A schema.org Recipe, checked strictly, read the way a page's JSON-LD is."""
    try:
        recipe = RecipeJson.model_validate(data)
    except ValidationError as error:
        raise NoRecipeError(f"That is no schema.org Recipe: {error.errors()[0]['msg']}") from error
    ld = {"@context": "https://schema.org", "@type": "Recipe", **recipe.model_dump()}
    # `</` would end the script tag early.
    script = json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")
    page = f'<html><head><script type="application/ld+json">{script}</script></head></html>'
    return from_html(page, source or "https://kasten.invalid/", source)


def note_text(recipe: Imported) -> str:
    """The recipe note: frontmatter, `## Zutaten` with its groups, `## Schritte`."""
    front = ["type: Recipe"]
    if recipe.servings is not None:
        front.append(f"servings: {recipe.servings}")
    if recipe.minutes is not None:
        front.append(f"time: {recipe.minutes} min")
    if recipe.source:
        front.append(f"source: {json.dumps(recipe.source)}")
    body = [f"# {recipe.title}", "", "## Zutaten"]
    for name, lines in recipe.groups:
        if name:
            body += ["", f"### {name}"]
        body += [f"- {line}" for line in lines]
    if recipe.steps:
        body += ["", "## Schritte", *(f"{at}. {step}" for at, step in enumerate(recipe.steps, 1))]
    return "---\n" + "\n".join(front) + "\n---\n" + "\n".join(body) + "\n"


def file_name(title: str) -> str:
    """A note name from the title, without the characters a path or a wikilink cannot hold."""
    name = " ".join(NOT_IN_NAME.sub(" ", title).split())[:120].strip(" .")
    return f"{name or 'Rezept'}.md"


async def fetch(url: str) -> tuple[str, str]:
    """The page at `url` and where it ended up, tried as a browser when a bot wall answers."""
    if urlsplit(url).scheme not in ("http", "https"):
        raise RefusedError(400, "Only http and https addresses")
    try:
        async with files.reader() as client:
            response = await files.open_public(client, url)
            try:
                if response.status_code not in WALLED:
                    return str(response.url), await _body(response)
            finally:
                await response.aclose()
    except httpx.HTTPError as error:
        raise RefusedError(502, f"Could not read that page: {error}") from error
    return await _as_browser(url)


async def _body(response: httpx.Response) -> str:
    if response.status_code >= PAGE_FAILED:
        raise RefusedError(502, f"That page answered {response.status_code}")
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body += chunk
        if len(body) > PAGE_LIMIT_BYTES:
            raise RefusedError(502, "That page is too big to read")
    return body.decode(response.charset_encoding or "utf-8", errors="replace")


async def _as_browser(url: str) -> tuple[str, str]:
    """A second try with a browser's TLS fingerprint, pinned to the address checked as public.

    curl resolves names itself, so `CURLOPT_RESOLVE` holds it to `public_address` on every hop.
    """
    for _ in range(files.PAGE_REDIRECTS + 1):
        parts = urlsplit(url)
        host = parts.hostname or ""
        address = await files.public_address(host)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        pinned = f"[{address}]" if ":" in address else address
        options = {
            CurlOpt.RESOLVE: [f"{host}:{port}:{pinned}"],
            CurlOpt.MAXFILESIZE_LARGE: PAGE_LIMIT_BYTES,
        }
        try:
            async with AsyncSession(trust_env=False, curl_options=options) as session:
                response = await session.get(
                    url,
                    impersonate="chrome",
                    allow_redirects=False,
                    timeout=files.PAGE_TIMEOUT_SECONDS,
                )
        except RequestsError as error:
            # libcurl's size cap ends the transfer with an error, not a short body.
            raise RefusedError(502, f"Could not read that page: {error}") from error
        location = response.headers.get("location")
        if response.is_redirect and location:
            url = str(httpx.URL(url).join(location))
            if urlsplit(url).scheme not in ("http", "https"):
                raise RefusedError(502, "That link redirects to no address")
            continue
        if response.status_code in WALLED:
            raise RefusedError(
                502,
                f"The site turned the fetch away ({response.status_code}); paste the recipe",
            )
        if response.status_code >= PAGE_FAILED:
            raise RefusedError(502, f"That page answered {response.status_code}")
        if len(response.content) > PAGE_LIMIT_BYTES:
            raise RefusedError(502, "That page is too big to read")
        return url, response.content.decode(response.charset or "utf-8", errors="replace")
    raise RefusedError(502, "That page redirects too many times")
