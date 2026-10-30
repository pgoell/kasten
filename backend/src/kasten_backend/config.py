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
    """Async SQLAlchemy URL for finance, RSVP places and the token record. Never holds notes."""

    activity_timeout_seconds: float = 2.0
    """How long one token-activity row may take to write before it is dropped.

    Bounded so a slow database cannot hold a connection open after the answer has gone out.
    """

    herdr_sessions_path: Path = Path("/herdr-home/.config/herdr/sessions")
    """Where the shell container keeps one directory per named herdr session.

    Mounted read-only, so the terminal prompt can list the sessions that exist. Nothing here
    starts, stops or reads into a session. Without the mount the list is empty.
    """

    archive_path: str = "98 Archive"
    """The folder holding what is finished, left out of the two rg passes.

    Nothing writes into it or moves into it, and it is otherwise an ordinary folder. The
    listing ignores it, so a `[[wikilink]]` to an archived note still resolves.
    """

    text_cache_path: Path = Path(tempfile.gettempdir()) / "kasten-text"
    """Where the text of the pdf, epub and html files is kept for search to read.

    Outside the vault, so nothing written here reaches the notes. It is rebuilt from the
    files, so losing it costs one extraction per book. The container empties it each release.
    """

    inbox_path: str = "00 Inbox"
    """The folder a note with nowhere else to go is made in.

    Broken `[[links]]`, clipped pages, dropped books and agent notes with no path land here.
    Books and documents go one level down, in `02 Books` and `02 Documents`;
    agent notes in `00 Agent`.
    """

    periodic_path: str = "01 Periodic"
    """The folder the daily, weekly, monthly, quarterly and yearly notes live under.

    Each kind has its own folder inside it, `00 Daily` to `04 Yearly`. One setting moves all five.
    """

    images_path: str = "99 Misc/02 Assets/01 Images"
    """The folder an image pasted or dropped into a note is written into."""

    config_path: str = "99 Misc/01 Config"
    """The folder holding the notes that describe the vault to its readers.

    The backend writes five of them at startup when missing: the reading guide, the ontology,
    and three agent guides in `01 Agents`. The todo pane keeps its saved views here too.
    """

    type_backfill: bool = True
    """Whether startup writes `type: Note` into every note that has no type.

    On by default, which makes the vault an Open Knowledge Format bundle. Turn it off before
    pointing kasten at an existing Obsidian vault: the pass rewrites every untyped note in one
    jj change, and a sync tool beside it copies that everywhere.
    """

    embed_model_dir: Path | None = None
    """The folder holding bge-m3's ONNX export, or None to keep the pieces index off.

    `model.onnx`, `model.onnx_data` and `tokenizer.json`, laid out by `fetch-bge-m3.sh` in
    server-infra. Off by default: the model is 2.2 GB and needs 2 GB of RAM.
    """

    pieces_skip: str = ""
    """A folder the pieces index leaves out, or empty for none.

    The flashcards: a deck is hundreds of one-line cards, which would crowd every search and
    cost an hour to embed.
    """

    flashcards_path: str = "03 Flashcards"
    """The folder an imported Anki deck is written into.

    Only the import needs it. A deck written by hand lives wherever you put it.
    """

    review_new_per_day: int | None = None
    """How many new cards a deck's sitting introduces a day, or None for every one.

    The default when the config note `decks.md` names no limit. Set here so that a 2,000 card
    import does not make the first sitting absurd.
    """

    review_reviews_per_day: int | None = None
    """How many due cards a deck's sitting asks a day, or None for every one.

    The other half of `review_new_per_day`.
    """

    trash_days: int = 30
    """How long a deleted note waits in `.trash` before it is dropped for good.

    Long enough to notice a mistaken delete, short enough that the trash is not a second vault.
    Counted from the timestamp in the entry's name, and read at startup, when the trash is emptied.
    """

    tokens_path: Path = Path("tokens.json")
    """The JSON file holding one record per agent token, beside the vault.

    Never inside the vault: a token there would enter jj history. Relative by default, like
    `vault_path`. The image and production mount a directory and set `/agent-data/tokens.json`:
    `os.replace` over a bind-mounted file fails with `EBUSY`.
    """

    github_user: str = ""
    """The GitHub login whose contributions the year and week review draws.

    Empty turns the review's GitHub section off. Never sent to the browser: the backend asks
    GitHub and answers with the days.
    """

    github_token: SecretStr | None = None
    """A GitHub token that may read the user's contributions, or None for off.

    A `SecretStr`, so a dump or a traceback shows `**********`. Sent only in the
    `Authorization` header, and only to GitHub.
    """

    github_cache_path: Path | None = None
    """Where the GitHub contributions read so far are kept, or None for beside the tokens.

    None means `github-contributions.json` in the tokens file's folder. Outside the vault for the
    same reason as the tokens: the file would enter jj history.
    """

    upload_path: Path = Path(tempfile.gettempdir()) / "kasten-uploads"
    """Where a file sent in pieces is joined before the route that finishes it reads it.

    Outside the vault, so a half-sent file never reaches the listing, the watcher or jj.
    Emptied at every start, since the pieces are kept in memory and a restart forgets them.
    """

    receipts_path: Path = Path("receipts")
    """Where finance receipts are kept, PDFs and photos by hash.

    Outside the vault, so a receipt never enters jj history. `GET /api/finance/receipts/{id}/file`
    is the only way to one. The image sets `/receipts`, a mount of `~/kasten-data/finance/receipts`.
    """

    upload_sweep_seconds: Annotated[float, Field(gt=0)] = UPLOAD_SWEEP_SECONDS
    """How often the backend deletes uploads idle over an hour.

    A setting so a test can sweep on every turn of the loop instead of waiting.
    """

    agent_host: str = ""
    """The `Host` the MCP endpoint answers to, or empty for any.

    The SDK's DNS-rebinding protection stays on, and its default allowlist is localhost only,
    so it answers 421 to everything through a proxy. Empty suits dev and the test client;
    production names the hostname Caddy serves.
    """

    skills_path: str = ".claude/skills"
    """The folder holding the Claude Code skills, which `list_skills` and `read_skill` read.

    Relative to the vault. It is the one hidden path an agent may read; the rest of `.claude`
    and every other dotfile stay out of reach. Nothing writes here through kasten.
    """

    share_folder: str = "05 Shared"
    """The one folder the `/share` routes reach, the shared lists living in it.

    Each list is a note directly inside it. Nothing outside it is readable or writable through
    those routes.
    """

    share_logs_done: bool = True
    """Whether a tick through the lists app writes the done log line a todo tick writes.

    On, a ticked shopping item shows in the day's `## Done`. `KASTEN_SHARE_LOGS_DONE=false`
    leaves it to its own list.
    """

    share_host: str = ""
    """The `Host` the shared lists app is served on, or empty for none.

    Requests with this host get 404 for every path outside `/share/`, so the public hostname
    reaches the lists and nothing else. Empty suits dev and the test client.
    """

    share_people: dict[str, str] = {}
    """Who the lists app's people are: sign-in address to person name, in menu order.

    JSON in the environment: `{"pascal@example.test": "Pascal"}`. A write by a listed address is
    named after the person in the history; an unlisted one writes as `share`. Addresses are
    stored lowercase, since the proxy's header is compared that way.
    """

    food_contact: str = "https://github.com/pgoell/kasten"
    """How Open Food Facts can reach whoever is asking, sent in every request's `User-Agent`.

    Open Food Facts asks every client to name a way to reach it. The default is this project's page.
    """

    weather_places: list[Place] = [
        Place(name="Gelnhausen", latitude=50.2017, longitude=9.1886),
        Place(name="Frankfurt", latitude=50.1109, longitude=8.6821),
    ]
    """The towns a daily note draws the weather for, in the order drawn.

    JSON in the environment, as `[{"name": ..., "latitude": ..., "longitude": ...}]`.
    An empty list draws no card.
    """

    vault_path: Path = Path("vault")
    """Directory of markdown files. This is the source of truth.

    Relative paths resolve against the working directory, so the app starts from the repo root.
    The backend image sets `/vault`, its mount point, so a container never falls back to a
    directory inside itself.
    """

    @field_validator("share_host")
    @classmethod
    def _host_as_a_request_spells_it(cls, value: str) -> str:
        """Lowercase and without a port, as the gate reads the `Host` a request carries.

        Compared as written, `Liste.Example:8443` would never match, and the gate would stay open
        with no error.
        """
        return value.strip().lower().partition(":")[0]

    @field_validator("share_people")
    @classmethod
    def _addresses_as_the_proxy_sends_them(cls, value: dict[str, str]) -> dict[str, str]:
        """Lowercase every address, since the proxy's header is matched in lowercase.

        Left as written, `Pascal@Example.test` would never match, and that person would write as
        `share` with no error.
        """
        return {address.strip().lower(): name for address, name in value.items()}

    @model_validator(mode="after")
    def _uploads_outside_the_vault(self) -> Self:
        """Refuse to start with the upload folder or the receipts inside the vault.

        Half-sent files there would reach the file tree, the watcher and jj, and the startup wipe
        would delete vault files named like an upload.
        """
        vault = self.vault_path.resolve()
        if self.upload_path.resolve().is_relative_to(vault):
            msg = f"KASTEN_UPLOAD_PATH must be outside the vault, {vault}"
            raise ValueError(msg)
        # A receipt in the vault would be a file any agent reads and jj keeps.
        if self.receipts_path.resolve().is_relative_to(vault):
            msg = f"KASTEN_RECEIPTS_PATH must be outside the vault, {vault}"
            raise ValueError(msg)
        return self

    @property
    def github_cache(self) -> Path:
        """Where the GitHub cache lives: `github_cache_path`, else beside the tokens file."""
        return self.github_cache_path or self.tokens_path.with_name("github-contributions.json")

    def fill(self, text: str) -> str:
        """`text` with each `{{folder}}` spelled the way this vault spells it.

        Guides and agent instructions name folders, and a vault with its own layout should read its
        own names. `{{folder|url}}` is the same folder encoded for a link or URL, where a raw space
        would end it.
        """
        folders = {
            "inbox": self.inbox_path,
            "periodic": self.periodic_path,
            "config": self.config_path,
            "archive": self.archive_path,
            "skills": self.skills_path,
        }
        for name, folder in folders.items():
            text = text.replace(f"{{{{{name}}}}}", folder)
            text = text.replace(f"{{{{{name}|url}}}}", quote(folder))
        return text


DEFAULTS = Settings.model_construct()
"""Every setting at its default, whatever the environment says.

The constants naming a default path are built from it, so each default is spelled once, and
the tests that pin one read the same value.
"""


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, built once."""
    return Settings()
