"""The HTTP API pages against the routes the app declares.

The index page's opening counts the `/api/` routes in words, and each route
gets a `## METHOD /api/...` section on one of the topic pages under
`docs/reference/http-api/`. Both drift silently when a route lands without a
doc change (#608), so this reads them back and compares them with the app's schema.
The agent texts that say what an upload takes are held to `ASSET_MAGIC` the same way (#1953).
"""

import re
from pathlib import Path

import pytest

from kasten_backend.main import app
from kasten_backend.vault import ASSET_MAGIC, AUDIO_SUFFIXES, CLIP_SUFFIXES, TABLE_SUFFIX

ROOT = Path(__file__).parents[2]
DOCS = ROOT / "docs" / "reference"
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
    # The count passed a hundred with #808, written as "one hundred and four".
    if word.startswith("one hundred"):
        rest = word.removeprefix("one hundred").strip().removeprefix("and").strip()
        return 100 + (number(rest) if rest else 0)
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
        r"serves\s+(?P<total>[a-z][a-z -]*?)\s+endpoints\s+under\s+`/api/`\.\s+"
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


# Typed, not derived: a suffix new to `ASSET_MAGIC` fails the first assert until it has a kind.
KINDS = {
    "PDF": (".pdf",),
    "epub": (".epub",),
    "image": (".png", ".jpg", ".jpeg", ".gif", ".webp"),
    "svg": (".svg",),
    "sound": AUDIO_SUFFIXES,
    "video": CLIP_SUFFIXES,
    "csv": (TABLE_SUFFIX,),
}
SUFFIX_LIST = "/reference/agent-api/routes.md#post-agentfilespath"


def paragraph(path: str, anchor: str) -> str:
    """The blank-line block of the file at `path`, under the repo root, that holds `anchor`."""
    blocks = (ROOT / path).read_text(encoding="utf-8").split("\n\n")
    (block,) = [block for block in blocks if anchor in block]
    return block


def test_every_upload_suffix_has_a_kind() -> None:
    assert sorted(s for suffixes in KINDS.values() for s in suffixes) == sorted(ASSET_MAGIC)


@pytest.mark.parametrize(
    ("path", "anchor"),
    [
        ("plugins/kasten/skills/vault/SKILL.md", "description:"),
        ("plugins/kasten/skills/vault/SKILL.md", "### File a"),
        ("backend/src/kasten_backend/agent/mcp-instructions.md", "save_file downloads"),
        ("docs/reference/agent-api/routes.md", "Puts one"),
    ],
)
def test_an_agent_text_names_every_kind_the_upload_takes(path: str, anchor: str) -> None:
    text = paragraph(path, anchor)

    assert [kind for kind in KINDS if not re.search(rf"\b{kind}\b", text, re.I)] == []


@pytest.mark.parametrize(
    "path", ["plugins/kasten/skills/vault/SKILL.md", "docs/reference/agent-api/routes.md"]
)
def test_an_upload_suffix_list_names_every_suffix(path: str) -> None:
    text = paragraph(path, "ends in `.pdf`")

    named = re.findall(r"`(\.[a-z0-9]+)`", text)
    assert set(named) == {*ASSET_MAGIC, ".html"}


@pytest.mark.parametrize(
    ("path", "anchor"),
    [
        ("docs/explanation/the-agent-boundary.md", "public URL the server downloads"),
        ("docs/how-to/connect-an-agent.md", "from your own disk"),
        ("docs/how-to/connect-an-agent.md", "Either product files"),
    ],
)
def test_a_docs_upload_line_points_at_the_suffix_list(path: str, anchor: str) -> None:
    assert SUFFIX_LIST in paragraph(path, anchor)


def test_the_upload_route_names_every_kind_the_file_tree_deletes() -> None:
    text = " ".join(
        paragraph("docs/reference/agent-api/routes.md", "There is no delete here").split()
    )
    clause = text.split("the browser's file tree deletes ", 1)[1].split(";", 1)[0]

    assert [kind for kind in ("image", "sound", "video", "csv") if kind not in clause] == []
