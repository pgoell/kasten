"""Every relative link in the docs points at a file and a heading that exist.

The docs are a Diátaxis tree whose pages move between folders (#611), and a
link broken by a move fails without any error. These tests read every inline
link in the docs and the top-level pages, then check each target against the
disk, each fragment against the headings of its target, and each docs page
against the rules that make it typed and reachable.
"""

import os
import re
from functools import cache
from pathlib import Path
from typing import NamedTuple
from urllib.parse import unquote

ROOT = Path(__file__).parents[2]
DOCS = ROOT / "docs"
EXTRA = [
    ROOT / ".claude" / "CLAUDE.md",
    ROOT / "README.md",
    ROOT / "deploy" / "README.md",
    ROOT / "SECURITY.md",
    ROOT / "plugins" / "kasten" / "skills" / "vault" / "SKILL.md",
]

# A fence opens with three or more backticks or tildes and closes with the same
# mark on a bare line. Examples inside a fence are not links, so they are skipped.
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
# `[text](target)` and `![alt](target)`, with an optional "title" after the target.
LINK = re.compile(r"!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+\"[^\"]*\")?\s*\)")
# A code span is blanked before links are looked for, so `[x](y)` in code is ignored.
CODE_SPAN = re.compile(r"(`+)[^`]*?\1")
SCHEME = re.compile(r"[a-zA-Z][a-zA-Z0-9+.-]*:")
HEADING = re.compile(r"^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$")
# Hand-written anchors, for the pages that place one instead of relying on a heading.
HTML_ANCHOR = re.compile(r"<a\s+(?:id|name)=\"([^\"]+)\"")


class Link(NamedTuple):
    source: Path
    line: int
    raw: str  # the target as written, with <> stripped
    path: str  # percent-decoded, empty for a same-page anchor
    fragment: str  # percent-decoded, empty when there is none
    dest: Path  # where the path points on disk


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def checked_files() -> list[Path]:
    return sorted([*DOCS.rglob("*.md"), *EXTRA])


def outside_fences(text: str) -> list[tuple[int, str]]:
    found = []
    fence = None
    for number, line in enumerate(text.splitlines(), 1):
        match = FENCE.match(line)
        if fence is None:
            if match:
                fence = match.group(1)
            else:
                found.append((number, line))
        elif (
            match
            and match.group(1)[0] == fence[0]
            and len(match.group(1)) >= len(fence)
            and not match.group(2).strip()
        ):
            fence = None
    return found


def destination(source: Path, path: str) -> Path:
    if not path:
        return source
    # Inside docs/, a leading "/" names the bundle root (see docs/index.md). Outside
    # it, the same slash means the repo root.
    if path.startswith("/"):
        base = DOCS if source.is_relative_to(DOCS) else ROOT
        path = path.lstrip("/")
    else:
        base = source.parent
    return Path(os.path.normpath(base / path))


def links() -> list[Link]:
    found = []
    for source in checked_files():
        for number, line in outside_fences(source.read_text(encoding="utf-8")):
            for match in LINK.finditer(CODE_SPAN.sub("", line)):
                raw = match.group(1).strip("<>")
                if SCHEME.match(raw):
                    continue
                path, _, fragment = raw.partition("#")
                path = unquote(path)
                found.append(
                    Link(
                        source,
                        number,
                        raw,
                        path,
                        unquote(fragment),
                        destination(source, path),
                    )
                )
    return found


def slug(heading: str) -> str:
    # Mirrors GitHub: punctuation goes, letters of any script stay, each space becomes a hyphen.
    kept = "".join(
        char for char in heading.replace("`", "").lower() if char.isalnum() or char in " -_"
    )
    return kept.replace(" ", "-")


@cache
def anchors(page: Path) -> frozenset[str]:
    text = page.read_text(encoding="utf-8")
    seen: dict[str, int] = {}
    found = set(HTML_ANCHOR.findall(text))
    for _, line in outside_fences(text):
        match = HEADING.match(line)
        if match:
            base = slug(match.group(1))
            count = seen.get(base, 0)
            seen[base] = count + 1
            found.add(base if count == 0 else f"{base}-{count}")
    return frozenset(found)


def has_type(page: Path) -> bool:
    lines = [line.rstrip() for line in page.read_text(encoding="utf-8").splitlines()]
    if not lines or lines[0] != "---" or "---" not in lines[1:]:
        return False
    end = lines.index("---", 1)
    return any(re.match(r"type:\s*\S", line) for line in lines[1:end])


def typed_pages() -> list[Path]:
    # Index pages and the changelog are navigation, not typed pages.
    return sorted(
        page
        for page in DOCS.rglob("*.md")
        if page.name != "index.md"
        and page != DOCS / "log.md"
        and not page.is_relative_to(DOCS / "log")
    )


def test_every_relative_link_resolves() -> None:
    broken = [
        f"{rel(link.source)}:{link.line} -> {link.raw}"
        for link in links()
        if not link.dest.exists()
    ]
    assert not broken, "\n".join(broken)


def test_every_anchor_lands_on_a_heading() -> None:
    missing = [
        f"{rel(link.source)}:{link.line} -> {link.raw}"
        for link in links()
        if link.fragment
        and link.dest.suffix == ".md"
        and link.dest.exists()
        and link.fragment not in anchors(link.dest)
    ]
    assert not missing, "\n".join(missing)


def test_every_page_carries_a_type() -> None:
    untyped = [rel(page) for page in typed_pages() if not has_type(page)]
    assert not untyped, "pages without a type in the frontmatter:\n" + "\n".join(untyped)


def test_every_page_is_linked_from_an_index() -> None:
    # A link from a page to itself does not make it reachable, so it is not counted.
    linked = {
        link.dest
        for link in links()
        if link.source.is_relative_to(DOCS) and link.dest != link.source
    }
    orphans = sorted(
        rel(page) for page in DOCS.rglob("*.md") if page != DOCS / "index.md" and page not in linked
    )
    assert not orphans, "pages no other docs page links to:\n" + "\n".join(orphans)
