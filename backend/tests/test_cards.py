"""What `GET /api/cards` finds in the vault, and what it refuses to call a card.

The backend does not parse a card. It finds the lines that could be part of one
and hands them over whole, so these tests are about the pattern and nothing
else. `srs.ts` decides which of these lines is a question and `review.ts`
decides which note is a deck at all; a `::` in a note carrying no tag still
comes back from here, because leaving it out would mean reading the whole note
to find out.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

DECK = """# AWS drills

#flashcards/aws

What does S3 stand for?::Simple Storage Service <!--SR:!2026-08-20,4,270-->

The three storage classes
?
Standard, Infrequent Access, Glacier
<!--SR:!2026-08-14,1,230-->
"""


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def test_finds_every_shape(client: AsyncClient, vault: Path) -> None:
    write(vault, "decks/aws.md", DECK)

    response = await client.get("/api/cards")

    assert response.status_code == 200
    assert response.json() == [
        {"path": "decks/aws.md", "line": 3, "text": "#flashcards/aws"},
        {
            "path": "decks/aws.md",
            "line": 5,
            "text": "What does S3 stand for?::Simple Storage Service <!--SR:!2026-08-20,4,270-->",
        },
        {"path": "decks/aws.md", "line": 8, "text": "?"},
        {"path": "decks/aws.md", "line": 10, "text": "<!--SR:!2026-08-14,1,230-->"},
    ]


FENCED = """# C++ drills

#flashcards/cpp

live::answer

```cpp
fenced::answer
```
"""


async def test_finds_a_fence(client: AsyncClient, vault: Path) -> None:
    write(vault, "decks/cpp.md", FENCED)

    response = await client.get("/api/cards")

    assert response.status_code == 200
    assert response.json() == [
        {"path": "decks/cpp.md", "line": 3, "text": "#flashcards/cpp"},
        {"path": "decks/cpp.md", "line": 5, "text": "live::answer"},
        {"path": "decks/cpp.md", "line": 7, "text": "```cpp"},
        {"path": "decks/cpp.md", "line": 8, "text": "fenced::answer"},
        {"path": "decks/cpp.md", "line": 9, "text": "```"},
    ]


async def test_finds_a_note_marked_for_review(client: AsyncClient, vault: Path) -> None:
    write(vault, "notes/tls.md", "---\nsr-due: 2026-08-20\n---\n# TLS\n\n#review\n")

    response = await client.get("/api/cards")

    assert response.status_code == 200
    assert response.json() == [
        {"path": "notes/tls.md", "line": 2, "text": "sr-due: 2026-08-20"},
        {"path": "notes/tls.md", "line": 6, "text": "#review"},
    ]


async def test_leaves_prose_alone(client: AsyncClient, vault: Path) -> None:
    write(vault, "notes/prose.md", "# Title\n\nAn ordinary sentence, no card in it.\n")

    response = await client.get("/api/cards")

    assert response.status_code == 200
    assert response.json() == []


async def test_walks_past_the_archive(client: AsyncClient, vault: Path) -> None:
    write(vault, "98 Archive/old.md", DECK)

    hidden = await client.get("/api/cards")
    shown = await client.get("/api/cards", params={"archive": "true"})

    assert hidden.json() == []
    assert len(shown.json()) == 4


async def test_a_vault_that_is_not_there_reads_as_empty(
    client: AsyncClient,
    missing_vault: Path,
) -> None:
    response = await client.get("/api/cards")

    assert response.status_code == 200
    assert response.json() == []
