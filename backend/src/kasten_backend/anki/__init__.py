"""Anki decks read into markdown notes, and the import routes `main` mounts.

`archive` reads an `.apkg` export, `ankiweb` fetches one by its link, `note` writes and merges
the note. The modules `apkg`, `ankiweb`, `imports` and `route` are exported so tests patch the
names they look up.
"""

from kasten_backend.anki import ankiweb, imports, route
from kasten_backend.anki.archive import apkg
from kasten_backend.anki.archive.apkg import media_path, read_apkg
from kasten_backend.anki.archive.deck import Card, Deck, Template
from kasten_backend.anki.archive.html import plain
from kasten_backend.anki.imports import stop
from kasten_backend.anki.note.merge import merge
from kasten_backend.anki.note.write import as_note, card_count
from kasten_backend.anki.route import router

__all__ = [
    "Card",
    "Deck",
    "Template",
    "ankiweb",
    "apkg",
    "as_note",
    "card_count",
    "imports",
    "media_path",
    "merge",
    "plain",
    "read_apkg",
    "route",
    "router",
    "stop",
]
