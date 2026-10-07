"""Application settings, read from the environment and backend/.env."""

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from pydantic_settings import BaseSettings, SettingsConfigDict

from kasten_backend.weather import Place


class Settings(BaseSettings):
    """Runtime configuration. Every field is overridable via a KASTEN_* env var."""

    model_config = SettingsConfigDict(
        env_prefix="KASTEN_",
        env_file=".env",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://kasten:kasten@localhost:5434/kasten_dev"
    """Async SQLAlchemy URL for the derived index. Never holds note content."""

    herdr_sessions_path: Path = Path("/herdr-home/.config/herdr/sessions")
    """Where the shell container keeps one directory per named herdr session.

    That container's home, mounted read-only from the volume it writes, so the
    terminal prompt can offer the sessions that already exist. Nothing here
    starts, stops or reads into a session; the path is only ever listed.

    The default is the container path rather than something relative, because
    production sets no environment variable for it. A backend without the mount
    answers with an empty list and the notebook is unaffected.
    """

    archive_path: str = "98 Archive"
    """The folder holding what is finished, left out of the two rg passes.

    An ordinary folder in the vault, and the only thing kasten knows about it is
    this name. Nothing writes into it, nothing moves anything into it, and a
    note in it opens and saves like any other; a search and the todo list simply
    do not walk it unless they are asked to.

    The listing is deliberately not filtered by it. `GET /api/files` is what
    resolves a `[[wikilink]]`, and a link to an archived note that read as a
    dead one would make a second note in the inbox out of a note the vault
    already holds.

    A setting rather than a constant because the number in front is one vault's
    filing convention, not kasten's. Set it to something no folder is called and
    nothing is left out of anything.
    """

    inbox_path: str = "00 Inbox"
    """The folder a note with nowhere else to go is made in.

    A `[[link]]` to a note that does not exist, a clipped page, a book dropped
    into the tree and an agent's note with no path given all land here. Books
    and documents go one level down, in `02 Books` and `02 Documents`, and an
    agent's notes in `00 Agent`.
    """

    periodic_path: str = "01 Periodic"
    """The folder the daily, weekly, monthly, quarterly and yearly notes live under.

    Each kind keeps its own folder inside it, `00 Daily` to `04 Yearly`. Only
    the parent is a setting: the five belong together, and one setting moves
    them all.
    """

    images_path: str = "99 Misc/02 Assets/01 Images"
    """The folder an image pasted or dropped into a note is written into."""

    config_path: str = "99 Misc/01 Config"
    """The folder holding the notes that describe the vault to its readers.

    The backend writes five notes under it at startup when they are missing: the
    reading guide here and the ontology and three agent guides in `01 Agents`.
    The todo pane keeps its saved views here too.
    """

    type_backfill: bool = True
    """Whether startup writes `type: Note` into every note that has no type.

    On by default, which is what makes the vault an Open Knowledge Format
    bundle. Turn it off before pointing kasten at a vault you already keep, an
    Obsidian one above all: the pass rewrites the frontmatter of every untyped
    note in one jj change, and a sync tool beside it will copy that everywhere.
    """

    flashcards_path: str = "03 Flashcards"
    """The folder an imported Anki deck is written into.

    A setting rather than a constant for the reason `archive_path` is one: the
    number in front is one vault's filing convention and not kasten's. Nothing
    else in kasten knows this folder exists. A deck written by hand lives
    wherever you put it, and only the import has to be told where to start.
    """

    trash_days: int = 30
    """How long a deleted note waits in `.trash` before it is dropped for good.

    Long enough to notice the delete was a mistake, short enough that the trash
    is not a second vault. Counted from the moment in the entry's own name, and
    read at startup, which is when the trash is emptied.
    """

    tokens_path: Path = Path("tokens.json")
    """The JSON file holding one record per agent token, beside the vault.

    Never inside it. A token there would enter jj history for good and sit one
    `search_notes` call away from any agent reading notes.

    Relative by default, which resolves against the working directory the way
    `vault_path` does. The backend image sets `/agent-data/tokens.json`, and
    production sets the same path in its env file: a file in a mounted
    directory; the directory is what is mounted and never this file, because
    `os.replace` over a bind-mounted file fails with `EBUSY` and every mint would
    break.
    """

    agent_host: str = ""
    """The `Host` the MCP endpoint answers to, or empty for any.

    The SDK's DNS-rebinding protection is left on, and its own default allowlist
    is localhost only, which answers 421 to everything arriving through a proxy.
    Empty is what dev on loopback and the test client need; production names the
    hostname Caddy serves.
    """

    weather_places: list[Place] = [
        Place(name="Gelnhausen", latitude=50.2017, longitude=9.1886),
        Place(name="Frankfurt", latitude=50.1109, longitude=8.6821),
    ]
    """The towns a daily note draws the weather for, in the order drawn.

    JSON in the environment: `[{"name": "Gelnhausen", "latitude": 50.2017,
    "longitude": 9.1886}]`. An empty list draws no card.
    """

    vault_path: Path = Path("vault")
    """Directory of markdown files. This is the source of truth.

    Relative paths resolve against the working directory, so the app is always
    started from the repo root. The backend image sets `/vault`, its mount
    point, so a container never falls back to a directory inside itself.
    """

    def fill(self, text: str) -> str:
        """`text` with each `{{folder}}` in it spelled the way this vault spells it.

        The guides the backend writes and the instructions an agent reads name
        folders, and a vault with its own layout should read its own names.
        `{{folder|url}}` is the same folder encoded for a link or a URL, where a
        raw space would end it.
        """
        folders = {
            "inbox": self.inbox_path,
            "periodic": self.periodic_path,
            "config": self.config_path,
            "archive": self.archive_path,
        }
        for name, folder in folders.items():
            text = text.replace(f"{{{{{name}}}}}", folder)
            text = text.replace(f"{{{{{name}|url}}}}", quote(folder))
        return text


DEFAULTS = Settings.model_construct()
"""Every setting at its default, whatever the environment says.

What the constants naming a default path are built from, so each default is
spelled once, here, and the tests that pin one read the same value.
"""


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, built once."""
    return Settings()
