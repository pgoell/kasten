"""The HTTP API pages against the routes the app declares.

The index page's opening counts the `/api/` routes in words, and each route
gets a `## METHOD /api/...` section on one of the topic pages under
`docs/reference/http-api/`. Both drift silently when a route lands without a
doc change (#608), so this reads them back and compares them with the app's schema.
"""

import re
from pathlib import Path

from kasten_backend.main import app

DOCS = Path(__file__).parents[2] / "docs" / "reference"
INDEX = DOCS / "http-api.md"
TOPICS = sorted((DOCS / "http-api").glob("*.md"))

# The one GET that streams rather than reads.
STREAM = ("GET", "/api/events")

UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
TEENS = [
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
]
TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def number(word: str) -> int:
    word = word.lower()
    if word in UNITS:
        return UNITS.index(word)
    if word in TEENS:
        return 10 + TEENS.index(word)
    tens, _, unit = word.partition("-")
    return 20 + 10 * TENS.index(tens) + (UNITS.index(unit) if unit else 0)


def api_routes() -> set[tuple[str, str]]:
    # Read off the schema rather than `app.routes`: the routes live on routers,
    # and FastAPI keeps an included router whole in `app.routes`, so walking it
    # finds none of them. The schema adds no HEAD to a GET and leaves out the
    # OAuth consent step, as the page does.
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith("/api/")
        for method in operations
    }


def test_the_http_api_page_counts_and_heads_every_api_route() -> None:
    index = INDEX.read_text(encoding="utf-8")
    pages = "\n".join(page.read_text(encoding="utf-8") for page in TOPICS)
    routes = api_routes()

    headings = {
        (match["method"], match["path"])
        for match in re.finditer(r"^## (?P<method>[A-Z]+) (?P<path>/api/\S+)$", pages, re.M)
    }
    assert headings == routes, (
        f"sections without a route: {sorted(headings - routes)}, "
        f"routes without a section: {sorted(routes - headings)}"
    )

    opening = re.search(
        r"serves\s+(?P<total>[a-z-]+)\s+endpoints\s+under\s+`/api/`\.\s+"
        r"(?P<read>[A-Za-z-]+)\s+read,\s+(?P<write>[a-z-]+)\s+write,\s+"
        r"and\s+(?P<stream>[a-z-]+)\s+streams?\.",
        index,
    )
    assert opening is not None
    stated = {part: number(opening[part]) for part in ("total", "read", "write", "stream")}
    reads = {route for route in routes if route[0] == "GET" and route != STREAM}
    actual = {
        "total": len(routes),
        "read": len(reads),
        "write": len(routes - reads - {STREAM}),
        "stream": len(routes & {STREAM}),
    }
    assert stated == actual
