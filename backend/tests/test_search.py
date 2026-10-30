"""What `GET /api/search` finds in the vault, and what it refuses to look at.

The vault is the source of truth here as everywhere else, so the rule these
tests hold to is that search sees exactly what `GET /api/files` lists. A note
the listing shows and the search cannot find is the bug this file exists to
catch.
"""

import os
import subprocess
from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path, PurePath
from typing import TYPE_CHECKING, Any

import pytest

from kasten_backend.cards import find_cards
from kasten_backend.config import get_settings
from kasten_backend.search import (
    MOST_HITS,
    SEEN_BY_THE_LISTING,
    notes_holding,
    relative_to_root,
    scan_vault,
)
from kasten_backend.todos import find_todos

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Sequence

    from httpx import AsyncClient


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def test_finds_the_line_a_word_is_on(client: AsyncClient, vault: Path) -> None:
    # A dated name, so the date the hit carries is fixed rather than the file's.
    write(vault, "projects/2026-10-07 kasten.md", "# kasten\n\nPostgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert response.status_code == 200
    assert response.json() == [
        {
            "path": "projects/2026-10-07 kasten.md",
            "line": 3,
            "text": "Postgres holds a derived index.",
            "place": None,
            "date": "2026-10-07",
            "tags": [],
        }
    ]


async def test_ignores_the_case_of_the_query(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "POSTGRES"})

    assert [hit["line"] for hit in response.json()] == [1]


async def test_reads_the_query_as_a_literal_and_not_a_regex(
    client: AsyncClient, vault: Path
) -> None:
    # `index.` as a regex matches "index " in the second note as well. The user
    # typed a sentence, not a pattern, so only the first note is a match.
    write(vault, "literal.md", "Postgres holds a derived index.\n")
    write(vault, "pattern.md", "Postgres holds a derived index and nothing else.\n")

    response = await client.get("/api/search", params={"q": "index."})

    assert [hit["path"] for hit in response.json()] == ["literal.md"]


async def test_does_not_choke_on_a_query_that_is_a_broken_regex(
    client: AsyncClient, vault: Path
) -> None:
    # Half a bracket is what a query looks like halfway through being typed.
    write(vault, "kasten.md", "A link reads [[like this]].\n")

    response = await client.get("/api/search", params={"q": "[[like"})

    assert response.status_code == 200
    assert [hit["text"] for hit in response.json()] == ["A link reads [[like this]]."]


async def test_reads_markdown_and_nothing_else(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "derived index\n")
    write(vault, "notes.txt", "derived index\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit["path"] for hit in response.json()] == ["kasten.md"]


async def test_skips_hidden_directories(client: AsyncClient, vault: Path) -> None:
    # The vault carries its own jj repo, and jj keeps copies of note text under
    # `.jj`. Finding those would show the same line twice, once at a path the
    # editor cannot open. `GET /api/files` skips hidden parts for this reason
    # and rg skips them by default; this is what says so out loud.
    write(vault, "kasten.md", "derived index\n")
    write(vault, ".jj/repo/store/blob", "derived index\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit["path"] for hit in response.json()] == ["kasten.md"]


async def test_finds_a_note_that_gitignore_ignores(client: AsyncClient, vault: Path) -> None:
    # The vault is a git repo, so it may hold a `.gitignore`, and rg reads one
    # by default. A note the listing shows has to be a note the search finds,
    # whatever git has been told to overlook.
    #
    # The `.git` directory is the point of the setup, not scenery: rg only
    # honours a `.gitignore` once it can see a repo around it, so without this
    # the test passes whether the flag is there or not.
    (vault / ".git").mkdir()
    write(vault, ".gitignore", "drafts/\n")
    write(vault, "drafts/kasten.md", "derived index\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit["path"] for hit in response.json()] == ["drafts/kasten.md"]


async def test_stops_at_the_cap(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "derived index\n" * (MOST_HITS + 100))

    response = await client.get("/api/search", params={"q": "derived"})

    assert len(response.json()) == MOST_HITS


async def test_answers_with_nothing_when_nothing_matches(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "wikilink"})

    assert response.status_code == 200
    assert response.json() == []


async def test_answers_with_nothing_for_a_blank_query(client: AsyncClient, vault: Path) -> None:
    # An empty literal matches every line in the vault, which is the one answer
    # nobody typing into a search box wants back.
    write(vault, "kasten.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": " "})

    assert response.json() == []


async def test_answers_with_nothing_for_a_vault_that_is_not_there(
    client: AsyncClient, missing_vault: Path
) -> None:
    response = await client.get("/api/search", params={"q": "derived"})

    assert response.status_code == 200
    assert response.json() == []


async def test_a_hit_in_a_daily_note_carries_the_date_in_its_name(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "01 Periodic/00 Daily/2026-10-07.md", "Ship the histogram.\n")

    response = await client.get("/api/search", params={"q": "histogram"})

    assert [hit.get("date") for hit in response.json()] == ["2026-10-07"]


async def test_a_hit_in_a_dated_note_carries_the_date_in_its_name(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "02 Projects/2026-09-18 Enablement.md", "Enablement kicks off.\n")

    response = await client.get("/api/search", params={"q": "enablement"})

    assert [hit.get("date") for hit in response.json()] == ["2026-09-18"]


async def test_a_hit_in_a_note_with_no_dated_name_carries_its_created_instant(
    client: AsyncClient, vault: Path
) -> None:
    # `stamp` writes `created` in UTC. The instant comes back whole, because cut
    # to its day a note written at 00:30 in Berlin would land the day before.
    write(
        vault,
        "projects/kasten.md",
        "---\ncreated: 2026-10-18T22:30:00+00:00\n---\n\nderived index\n",
    )

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit.get("date") for hit in response.json()] == ["2026-10-18T22:30:00+00:00"]


async def test_a_hit_in_a_note_with_no_date_carries_the_file_modification_instant(
    client: AsyncClient, vault: Path
) -> None:
    # Set rather than left to the checkout, which stamps every file with the day
    # it was cloned and would pass this test on any day at all.
    write(vault, "projects/undated.md", "derived index\n")
    moment = datetime(2026, 7, 15, 12, tzinfo=UTC).timestamp()
    os.utime(vault / "projects/undated.md", (moment, moment))

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit.get("date") for hit in response.json()] == ["2026-07-15T12:00:00+00:00"]


async def test_a_hit_in_a_note_whose_created_has_no_offset_carries_it_as_written(
    client: AsyncClient, vault: Path
) -> None:
    # Imported notes write `created` without an offset. A browser reads that as
    # the reader's own local time, so the value goes out as it is written.
    write(
        vault, "projects/imported.md", "---\ncreated: 2026-08-02T09:00:00\n---\n\nderived index\n"
    )

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit.get("date") for hit in response.json()] == ["2026-08-02T09:00:00"]


async def test_a_hit_in_a_note_whose_created_is_a_week_date_falls_to_the_file_instant(
    client: AsyncClient, vault: Path
) -> None:
    # `new Date` does not read a week date, so `created` in that form is no use
    # to the client and the file's own time stands in for it.
    write(
        vault,
        "projects/weekly.md",
        "---\ncreated: 2026-W43-1T10:00:00+00:00\n---\n\nderived index\n",
    )
    moment = datetime(2026, 7, 15, 12, tzinfo=UTC).timestamp()
    os.utime(vault / "projects/weekly.md", (moment, moment))

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit.get("date") for hit in response.json()] == ["2026-07-15T12:00:00+00:00"]


async def test_a_hit_carries_its_notes_tags_with_their_hashes_sorted(
    client: AsyncClient, vault: Path
) -> None:
    # The frontmatter's `tags` field and an inline hash both count, and a tag
    # named both ways comes back once.
    write(vault, "kasten.md", "---\ntags: [zeta, alpha]\n---\n\nDerived index #beta and #alpha.\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit.get("tags") for hit in response.json()] == [["#alpha", "#beta", "#zeta"]]


async def test_two_hits_in_one_note_share_its_date_and_tags(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "01 Periodic/00 Daily/2026-10-07.md", "derived index #kasten\nderived again\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert [(hit.get("date"), hit.get("tags")) for hit in response.json()] == [
        ("2026-10-07", ["#kasten"]),
        ("2026-10-07", ["#kasten"]),
    ]


DEV_VAULT = Path("/home/pascal/Code/kasten/vault")
"""The author's own notes, read and never written, for the one test that needs real ones."""


def name_date(path: str) -> date | None:
    """The date a note's file name starts with, or None when it starts with none."""
    try:
        return date.fromisoformat(Path(path).name[:10])
    except ValueError:
        return None


def walk_counts(word: str, archive: str) -> Counter[tuple[int, int]]:
    """Lines holding `word` per ISO week, counted without the route's code.

    Every dated note outside the archive and outside hidden folders, each line
    that holds the word, by the week of the day its name carries.
    """
    expected: Counter[tuple[int, int]] = Counter()
    for note in sorted(DEV_VAULT.rglob("*.md")):
        parts = note.relative_to(DEV_VAULT).parts
        day = name_date(note.name)
        if day is None or any(part.startswith(".") or part == archive for part in parts):
            continue
        for line in note.read_bytes().decode("utf-8", "replace").split("\n"):
            if word in line.lower():
                expected[day.isocalendar()[:2]] += 1
    return expected


@pytest.mark.skipif(not DEV_VAULT.exists(), reason="needs the dev vault, which CI does not have")
async def test_the_weekly_counts_match_a_walk_of_the_dev_vault(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # `the` is common enough to make the histogram worth looking at, and rare
    # enough that the notes' lines are under the cap, which would otherwise cut
    # them short. The dev vault's pdf, epub and html files fill the rest of the
    # answer, after the notes, and are counted by the walk of notes nowhere.
    word = "the"
    monkeypatch.setenv("KASTEN_VAULT_PATH", str(DEV_VAULT))
    get_settings.cache_clear()
    archive = get_settings().archive_path

    response = await client.get("/api/search", params={"q": word})

    assert response.status_code == 200
    notes = [hit for hit in response.json() if hit["place"] is None]
    assert len(notes) < MOST_HITS

    found: Counter[tuple[int, int]] = Counter()
    for hit in notes:
        day = name_date(hit["path"])
        if day is None:
            continue
        assert hit["date"] == day.isoformat()
        found[day.isocalendar()[:2]] += 1

    expected = walk_counts(word, archive)

    assert expected
    assert found == expected


# The shortcut that strips the vault off each path rg prints (#1353). It has to
# give what `Path.relative_to` gives, on names that would trip a naive split and
# on each way a root can be written, and the readers must not go back to one
# `relative_to` per hit, which these count rather than time.

LITERAL = "marker"

BODY = "card marker::answer\n- [ ] marker todo\n"
"""One card line and one todo line, both holding `LITERAL`."""

NAMES = [
    "plain.md",
    "with space.md",
    "ünïcödé ñ.md",
    "日本語.md",
    "brackets [x].md",
    "pipe | bar.md",
    "hash #tag.md",
    "sub dir [1]/#deep|note.md",
]


def rg_paths(root: Path) -> list[str]:
    """The path of every line rg prints for `LITERAL`, read from rg and not from this code."""
    raw = subprocess.run(  # noqa: S603
        [  # noqa: S607
            "rg",
            "--line-number",
            "--with-filename",
            "--no-heading",
            "--null",
            *SEEN_BY_THE_LISTING,
            "-e",
            LITERAL,
            "--",
            str(root),
        ],
        capture_output=True,
        check=True,
    )
    return [line.partition("\0")[0] for line in raw.stdout.decode("utf-8").split("\n") if line]


def root_as(form: str, tmp_path: Path, vault: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    if form == "absolute":
        return vault
    if form == "trailing_slash":
        # `Path` drops the slash, so this is the absolute form in practice. It stays
        # because a caller could still build the root this way.
        return Path(f"{vault}/")
    if form == "symlink":
        link = tmp_path / "link"
        link.symlink_to(vault, target_is_directory=True)
        return link
    if form == "relative":
        monkeypatch.chdir(tmp_path)
        return Path("vault")
    monkeypatch.chdir(vault)
    return Path()


@pytest.mark.parametrize("form", ["absolute", "trailing_slash", "symlink", "relative", "dot"])
async def test_1353_a4_paths_match_relative_to_for_awkward_names(
    form: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = tmp_path / "vault"
    for name in NAMES:
        write(vault, name, BODY)
    root = root_as(form, tmp_path, vault, monkeypatch)

    found = rg_paths(root)
    assert len(found) == 2 * len(NAMES)

    relative = relative_to_root(root)
    for path in found:
        assert relative(path) == str(Path(path).relative_to(root))

    expected = [str(Path(path).relative_to(root)) for path in found]
    assert sorted(set(expected)) == sorted(NAMES)

    # Order is not compared: rg prints files from several threads, so two runs can
    # disagree on which note comes first.
    hits = await scan_vault(root, ("-e", LITERAL), 1000)
    assert sorted(hit.path for hit in hits) == sorted(expected)

    holding = await notes_holding(root, LITERAL)
    assert sorted(holding) == sorted(set(expected))


def test_1353_a6_root_of_slash_falls_back_to_relative_to() -> None:
    # Under `/` the prefix is `//`, which no path starts with, so the old
    # expression runs. It has to still give the same answer.
    relative = relative_to_root(Path("/"))

    assert relative("/etc/hosts") == "etc/hosts"
    assert relative("/etc/hosts") == str(Path("/etc/hosts").relative_to(Path("/")))


@pytest.mark.parametrize(
    "reader",
    [
        pytest.param(find_cards, id="cards"),
        pytest.param(find_todos, id="todos"),
        pytest.param(lambda root: scan_vault(root, ("-e", LITERAL), 1000), id="scan_vault"),
        pytest.param(lambda root: notes_holding(root, LITERAL), id="notes_holding"),
    ],
)
async def test_1353_a1_readers_call_relative_to_no_times(
    reader: Callable[[Path], Awaitable[Sequence[Any]]],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    vault = tmp_path / "vault"
    for folder in range(5):
        for note in range(10):
            write(vault, f"folder {folder}/note {note}.md", BODY)

    calls = 0
    original = PurePath.relative_to

    def counting(self: PurePath, *args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        return original(self, *args, **kwargs)

    monkeypatch.setattr(PurePath, "relative_to", counting)

    found = await reader(vault)

    assert len(found) >= 50
    assert calls == 0
