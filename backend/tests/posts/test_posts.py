from typing import TYPE_CHECKING

from kasten_backend.posts.published import slugify

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def _note(vault: Path, path: str, fields: str, body: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(f"---\n{fields}\n---\n{body}")


async def test_lists_only_published_notes_newest_first(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    _note(agent_vault, "Blog/Old.md", "publish: true\ndate: 2026-01-02", "# Old post\n\nHi")
    _note(
        agent_vault,
        "Blog/Neu.md",
        "publish: yes\ndate: 2026-03-04\nlang: DE\ndescription: Kurz\ntranslationKey: new",
        "Text",
    )
    _note(agent_vault, "Blog/Draft.md", "publish: false\ndate: 2026-05-06", "Not yet")
    _note(agent_vault, "Private.md", "date: 2026-05-06", "publish: true in the body only")
    _note(agent_vault, "98 Archive/Gone.md", "publish: true\ndate: 2026-05-06", "Archived")

    response = await client.get("/agent/posts", headers=bearer)

    assert response.status_code == 200
    assert response.json() == [
        {
            "slug": "neu",
            "title": "Neu",
            "date": "2026-03-04",
            "description": "Kurz",
            "lang": "de",
            "translation_key": "new",
        },
        {
            "slug": "old",
            "title": "Old post",
            "date": "2026-01-02",
            "description": None,
            "lang": None,
            "translation_key": None,
        },
    ]


async def test_a_post_drops_its_heading_and_points_links_at_posts(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    _note(agent_vault, "Blog/Other.md", "publish: true\ndate: 2026-01-01\nslug: other-one", "x")
    _note(agent_vault, "Ideas.md", "", "private")
    _note(
        agent_vault,
        "Blog/Main.md",
        "publish: true\ndate: 2026-02-01\ntitle: The main one",
        "# Main\n\nSee [[Other|this]], [[Ideas]] and ![[photo.png]].\n\n`[[kept]]`\n",
    )

    response = await client.get("/agent/posts/the-main-one", headers=bearer)
    assert response.status_code == 404

    response = await client.get("/agent/posts/main", headers=bearer)

    assert response.status_code == 200
    found = response.json()
    assert found["title"] == "The main one"
    assert found["body"] == "See [this](other-one), Ideas and .\n\n`[[kept]]`\n"


async def test_a_post_picks_the_language_asked_for(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    _note(agent_vault, "en/Hello.md", "publish: true\ndate: 2026-01-01\nlang: en", "Hello")
    _note(agent_vault, "de/Hello.md", "publish: true\ndate: 2026-01-01\nlang: de", "Hallo")

    german = await client.get("/agent/posts/hello", params={"lang": "de"}, headers=bearer)

    assert german.json()["body"] == "Hallo"


async def test_a_post_with_no_date_is_not_published(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    _note(agent_vault, "Undated.md", "publish: true", "x")

    assert (await client.get("/agent/posts", headers=bearer)).json() == []


def test_slugs_fold_german_letters() -> None:
    assert slugify("Über Größe & Maß!") == "ueber-groesse-mass"
