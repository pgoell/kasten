"""Find the published notes and render each as a post: its fields, and its body as markdown."""

import re
import unicodedata
from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend.books.library import note_text
from kasten_backend.code_spans import WIKILINK, code_spans, inside
from kasten_backend.frontmatter import body_start, created, field
from kasten_backend.links import link_path, names_a_file, split_target
from kasten_backend.search import notes_holding
from kasten_backend.vault import list_markdown_files

if TYPE_CHECKING:
    from kasten_backend.config import Settings

YES = frozenset({"true", "yes"})
"""What `publish:` must say. Anything else, a typo included, keeps the note private."""

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")
# The title ends only after a non-blank, or is one blank, and one `\s*` owns each blank run, so
# a long blank run is read once (#1905). The leading run is taken whole or up to its last blank,
# and closing hashes start where a hash run starts or after the title's first `#`, as `ATX` does
# (#1908).
HEADING = re.compile(r"^#(?: +(?! )| +(?= (?! )))((?=\s).|.+?(?<!\s))\s*(?:(?<!\S#)#+\s*)?$")

# Folded by hand first: NFKD alone turns `ä` into `a`, where German writes `ae`.
_GERMAN = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


class PostMeta(BaseModel):
    """What the blog's list shows of a post. No path: a note's folder stays private."""

    slug: str
    title: str
    date: str
    description: str | None
    lang: str | None
    translation_key: str | None


class Post(PostMeta):
    """One post with its body: markdown, the block and a leading `# title` taken off."""

    body: str


class _Found(PostMeta):
    path: str
    text: str


def slugify(name: str) -> str:
    """`name` as a URL segment: lowercase ASCII words joined by hyphens."""
    folded = unicodedata.normalize("NFKD", name.lower().translate(_GERMAN))
    ascii_only = folded.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-") or "post"


def _split_heading(body: str) -> tuple[str | None, str]:
    """The `# title` the body opens with, if any, and the body without it."""
    stripped = body.lstrip("\r\n")
    first, _, rest = stripped.partition("\n")
    match = HEADING.match(first)
    return (match.group(1), rest.lstrip("\r\n")) if match else (None, stripped)


def _found(path: str, text: str) -> _Found | None:
    """The post the note at `path` makes, or None when it is not published or has no date."""
    if (field(text, "publish") or "").lower() not in YES:
        return None
    date = field(text, "date") or created(text) or ""
    if not DATE.match(date):
        return None
    heading, _ = _split_heading(text[body_start(text) :])
    slug = field(text, "slug") or ""
    name = path.rsplit("/", 1)[-1].removesuffix(".md")
    return _Found(
        path=path,
        text=text,
        slug=slug if SLUG.match(slug) else slugify(name),
        title=field(text, "title") or heading or name,
        date=date[:10],
        description=field(text, "description") or None,
        lang=(field(text, "lang") or "").lower() or None,
        translation_key=field(text, "translation_key") or field(text, "translationKey") or None,
    )


async def _published(settings: Settings) -> list[_Found]:
    """Every published note outside the archive, newest first, then by path."""
    root = settings.vault_path
    found = [
        post
        for path in sorted(await notes_holding(root, "publish:", skip=settings.archive_path))
        if (post := _found(path, note_text(root, path))) is not None
    ]
    return sorted(found, key=lambda post: post.date, reverse=True)


def _meta(found: _Found) -> PostMeta:
    return PostMeta(**found.model_dump(exclude={"path", "text"}))


async def posts(settings: Settings) -> list[PostMeta]:
    """Every published post, newest first."""
    return [_meta(found) for found in await _published(settings)]


async def post(settings: Settings, slug: str, lang: str | None = None) -> Post | None:
    """The post at `slug`, in `lang` when one in it is there; None when none is published."""
    found = await _published(settings)
    same = [one for one in found if one.slug == slug]
    wanted = lang.lower() if lang else None
    chosen = next((one for one in same if wanted and one.lang == wanted), same[0] if same else None)
    if chosen is None:
        return None
    _, body = _split_heading(chosen.text[body_start(chosen.text) :])
    paths = list_markdown_files(settings.vault_path)
    slugs = {one.path: one.slug for one in found}
    return Post(**_meta(chosen).model_dump(), body=_relinked(body, paths, slugs))


def _relinked(body: str, paths: list[str], slugs: dict[str, str]) -> str:
    """`body` with each wikilink to a post made a link to it, the rest left as their words.

    An embed, `![[...]]`, goes: the site has no way to the file yet. Code keeps its brackets.
    """
    code = code_spans(body)
    out: list[str] = []
    last = 0
    for match in WIKILINK.finditer(body):
        if inside(match.start(), code):
            continue
        start = match.start()
        embed = start > 0 and body[start - 1] == "!"
        out.append(body[last : start - 1 if embed else start])
        last = match.end()
        if embed:
            continue
        target = split_target(match.group(1))
        words = target.alias or target.name.rsplit("/", 1)[-1] or target.heading or ""
        slug = None if names_a_file(target.name) else slugs.get(link_path(match.group(1), paths))
        out.append(f"[{words}]({slug})" if slug else words)
    out.append(body[last:])
    return "".join(out)
