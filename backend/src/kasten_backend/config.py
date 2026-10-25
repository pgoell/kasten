"""Application settings, read from the environment and backend/.env."""

import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Self
from urllib.parse import quote

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from kasten_backend.uploads import UPLOAD_SWEEP_SECONDS
from kasten_backend.weather import Place


class Settings(BaseSettings):
    """Runtime configuration. Every field is overridable via a KASTEN_* env var."""

    model_config = SettingsConfigDict(
        env_prefix="KASTEN_",
        env_file=".env",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://kasten:kasten@localhost:5434/kasten_dev"
    """Async SQLAlchemy URL for the derived index, finance and RSVP places. Never holds notes."""

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

    review_new_per_day: int | None = None
    """How many new cards a deck's sitting introduces a day, or None for every one.

    The default for a deck the config note `decks.md` names no limit for, nor
    any deck above it. A setting and not only the note because a 2,000 card
    import should not make the first sitting absurd in a vault nobody configured.
    """

    review_reviews_per_day: int | None = None
    """How many due cards a deck's sitting asks a day, or None for every one.

    The other half of `review_new_per_day`, read the same way.
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

    github_user: str = ""
    """The GitHub login whose contributions the year and week review draws.

    Empty, the review's GitHub section is off. Read with `github_token`, and
    never sent to the browser: the backend asks GitHub and answers the days.
    """

    github_token: SecretStr | None = None
    """A GitHub token that may read the user's contributions, or None for off.

    A `SecretStr`, so a settings dump or a traceback shows `**********`. It is
    sent to GitHub in the `Authorization` header and nowhere else.
    """

    github_cache_path: Path | None = None
    """Where the GitHub contributions read so far are kept, or None for beside the tokens.

    None is `github-contributions.json` in the tokens file's folder, which is
    `github_cache` below. Outside the vault for the reason the tokens are: the
    file would enter jj history and sit beside every note an agent reads.
    """

    upload_path: Path = Path(tempfile.gettempdir()) / "kasten-uploads"
    """Where a file sent in pieces is joined before the route that finishes it reads it.

    Outside the vault, so a half-sent file never reaches the listing, the
    watcher or jj. Emptied at every start, since the pieces received are kept
    in memory and a restart forgets them.
    """

    upload_sweep_seconds: Annotated[float, Field(gt=0)] = UPLOAD_SWEEP_SECONDS
    """How often the backend deletes uploads idle over an hour.

    A setting so a test can sweep on every turn of the loop rather than wait.
    """

    agent_host: str = ""
    """The `Host` the MCP endpoint answers to, or empty for any.

    The SDK's DNS-rebinding protection is left on, and its own default allowlist
    is localhost only, which answers 421 to everything arriving through a proxy.
    Empty is what dev on loopback and the test client need; production names the
    hostname Caddy serves.
    """

    share_folder: str = "05 Shared"
    """The one folder the `/share` routes reach, the shared lists living in it.

    Each list is a note directly inside it. Nothing outside it is readable or
    writable through those routes, and nothing else in kasten reads it. A setting
    for the same reason `archive_path` is one: the number in front is one vault's
    filing convention.
    """

    share_host: str = ""
    """The `Host` the shared lists app is served on, or empty for none.

    Requests arriving with this host answer 404 for every path outside
    `/share/`, so the public hostname reaches the lists and nothing else. Empty
    leaves every host the same, which is what dev and the test client need.
    """

    share_people: dict[str, str] = {}
    """Who the shared lists app's people are: sign-in address to person name, in menu order.

    JSON in the environment: `{"pascal@example.test": "Pascal"}`. The proxy sends
    the address of whoever signed in, and a write made by a listed address is
    named after the person in the history. An address not listed writes as
    `share`, and has no "Ich" in the app. Addresses compare case-insensitively,
    so they are stored lowercase.
    """

    food_contact: str = "https://github.com/pgoell/kasten"
    """How Open Food Facts can reach whoever is asking, sent in every request's `User-Agent`.

    Open Food Facts asks every client to name a way to reach it in its
    `User-Agent`. The default is this project's page.
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

    @field_validator("share_host")
    @classmethod
    def _host_as_a_request_spells_it(cls, value: str) -> str:
        """Lowercase and without a port, the way the gate reads the `Host` a request carries.

        Compared as written, `Liste.Example:8443` would never equal the header and
        the gate would stay open without any error to say so.
        """
        return value.strip().lower().partition(":")[0]

    @field_validator("share_people")
    @classmethod
    def _addresses_as_the_proxy_sends_them(cls, value: dict[str, str]) -> dict[str, str]:
        """Lowercase every address, since the header is matched against them as lowercase.

        Left as written, `Pascal@Example.test` would never equal the header, and
        that person would write as `share` with no error to say why.
        """
        return {address.strip().lower(): name for address, name in value.items()}

    @model_validator(mode="after")
    def _uploads_outside_the_vault(self) -> Self:
        """Refuse to start with the upload folder in the vault.

        Half-sent files there would reach the file tree, the watcher and jj,
        and the wipe at startup would delete vault files that happen to be
        named like an upload.
        """
        vault = self.vault_path.resolve()
        if self.upload_path.resolve().is_relative_to(vault):
            msg = f"KASTEN_UPLOAD_PATH must be outside the vault, {vault}"
            raise ValueError(msg)
        return self

    @property
    def github_cache(self) -> Path:
        """Where the GitHub cache lives: `github_cache_path`, else beside the tokens file."""
        return self.github_cache_path or self.tokens_path.with_name("github-contributions.json")

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
