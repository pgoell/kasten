"""The HTTP API page against the routes the app declares.

The page's opening counts the `/api/` routes in words and gives each one a
`## METHOD /api/...` section. Both drift silently when a route lands without a
doc change (#608), so this reads them back and compares them with `app.routes`.
"""

import re
from pathlib import Path

from fastapi.routing import APIRoute

from kasten_backend.main import app

DOC = Path(__file__).parents[2] / "docs" / "reference" / "http-api.md"

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
    # FastAPI's APIRoute keeps the methods it was given and adds no HEAD to a
    # GET. The OAuth consent step is left out of the schema, and so of the page.
    return {
        (method, route.path.replace(":path}", "}"))
        for route in app.routes
        if isinstance(route, APIRoute)
        and route.include_in_schema
        and route.path.startswith("/api/")
        for method in route.methods or ()
    }


def test_the_http_api_page_counts_and_heads_every_api_route() -> None:
    text = DOC.read_text(encoding="utf-8")
    routes = api_routes()

    headings = {
        (match["method"], match["path"])
        for match in re.finditer(r"^## (?P<method>[A-Z]+) (?P<path>/api/\S+)$", text, re.M)
    }
    assert headings == routes, (
        f"sections without a route: {sorted(headings - routes)}, "
        f"routes without a section: {sorted(routes - headings)}"
    )

    opening = re.search(
        r"serves\s+(?P<total>[a-z-]+)\s+endpoints\s+under\s+`/api/`\.\s+"
        r"(?P<read>[A-Za-z-]+)\s+read,\s+(?P<write>[a-z-]+)\s+write,\s+"
        r"and\s+(?P<stream>[a-z-]+)\s+streams?\.",
        text,
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
