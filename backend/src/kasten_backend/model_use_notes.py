"""The monthly notes the collector writes, and the reading of them the year review does.

One note per month, `<config>/Model use/YYYY-MM.md`. The collector owns a note
only when its frontmatter carries `generator: kasten-model-use`; a note at the
path without it belongs to someone else and is never written.
"""

from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING
from uuid import uuid7

from kasten_backend.model_use_lines import Usage, format_line, parse_line

if TYPE_CHECKING:
    from pathlib import Path

GENERATOR = "kasten-model-use"
"""The frontmatter field that says the collector wrote the note, and its value."""

SENTENCE = "The collector writes this note, and its lines are rewritten for the days a run covers."
"""The one sentence under the heading. Kept verbatim so a rewrite can find and drop it."""

FENCE = "---"


def heading(month: str) -> str:
    """The heading a month's note opens with."""
    return f"# Model use {month}"


def months(first: date, last: date) -> list[str]:
    """Each month, as `YYYY-MM`, that a day from `first` to `last` falls in."""
    found = []
    day = first.replace(day=1)
    while day <= last:
        found.append(day.isoformat()[:7])
        day = (day + timedelta(days=32)).replace(day=1)
    return found


def note_path(vault: Path, config_path: str, month: str) -> Path:
    """Where a month's note is, under the config folder."""
    return vault / config_path / "Model use" / f"{month}.md"


def _split(text: str) -> tuple[list[str], list[str]]:
    """The frontmatter's lines and the body's. No block means no frontmatter lines."""
    lines = text.split("\n")
    if lines[0].rstrip() != FENCE:
        return [], lines
    end = next((i for i, line in enumerate(lines[1:], 1) if line.strip() == FENCE), None)
    if end is None:
        return [], lines
    return lines[1:end], lines[end + 1 :]


def _field(front: list[str], key: str) -> str | None:
    """The value of a frontmatter field as written, or None when the block has no such line."""
    for line in front:
        name, separator, value = line.partition(":")
        if separator and name.strip() == key:
            return value.strip()
    return None


def read_month(path: Path, first: str, last: str) -> list[Usage]:
    """The usage lines of a collector note from `first` to `last`, or none for any other note."""
    if not path.is_file():
        return []
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []

    front, body = _split(text)
    if _field(front, "generator") != GENERATOR:
        return []
    usages = [parse_line(line) for line in body]
    return [usage for usage in usages if usage is not None and first <= usage.day <= last]


def _foreign(body: list[str], month: str) -> list[str]:
    """The body's lines the collector did not write, with no blank lines at either end."""
    kept = [
        line
        for line in body
        if parse_line(line) is None and line.rstrip() not in (heading(month), SENTENCE)
    ]
    # The blank lines between the collector's parts would otherwise grow a line each run.
    while kept and not kept[0].strip():
        kept.pop(0)
    while kept and not kept[-1].strip():
        kept.pop()
    return kept


def _render(ident: str, created: str, modified: str, body: list[str]) -> str:
    """The whole note: the frontmatter the collector writes, then the body."""
    front = [
        FENCE,
        f"id: {ident}",
        f"created: {created}",
        f"modified: {modified}",
        "type: Reference",
        f"generator: {GENERATOR}",
        FENCE,
    ]
    return "\n".join([*front, *body]) + "\n"


def _usage_entries(
    body: list[str], fresh: list[Usage], first: str, last: str
) -> list[tuple[Usage, str]]:
    """The usage lines to write, as (usage, text), sorted by day, model and project.

    A body line outside the range keeps its text, so it is written back byte for byte.
    """
    entries = []
    for line in body:
        usage = parse_line(line)
        if usage is not None and not first <= usage.day <= last:
            entries.append((usage, line))
    entries += [(usage, format_line(usage)) for usage in fresh]
    return sorted(entries, key=lambda entry: (entry[0].day, entry[0].model, entry[0].project))


def _body(month: str, entries: list[tuple[Usage, str]], foreign: list[str]) -> list[str]:
    """The body: heading, sentence, the usage lines, then the lines the collector did not write."""
    lines = [heading(month), "", SENTENCE]
    if entries:
        lines += ["", *(line for _, line in entries)]
    if foreign:
        lines += ["", *foreign]
    return lines


def write_month(  # noqa: PLR0913, PLR0917  each part of a month's note is its own argument
    path: Path, month: str, fresh: list[Usage], first: str, last: str, now: datetime
) -> str:
    """Write a month's note with the `fresh` lines for the days from `first` to `last`.

    Returns `written`, `unchanged` or `left alone`, or an empty string when there is
    nothing to write and no note to write it into. Lines of other days stay byte for
    byte, and so does everything the collector did not write. A write goes to a hidden
    file beside the note and is renamed over it, so a broken run leaves the old note.
    """
    text = path.read_text(encoding="utf-8") if path.is_file() else None
    if text is None and not fresh:
        return ""
    if text is not None and _field(_split(text)[0], "generator") != GENERATOR:
        return "left alone"

    stamp = now.isoformat(timespec="seconds")
    front, body = _split(text or "")
    lines = _body(month, _usage_entries(body, fresh, first, last), _foreign(body, month))
    ident = _field(front, "id") or str(uuid7())
    created = _field(front, "created") or stamp
    # The same bytes as the file means nothing changed, so the file keeps its mtime too.
    if (
        text is not None
        and _render(ident, created, _field(front, "modified") or stamp, lines) == text
    ):
        return "unchanged"

    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(_render(ident, created, stamp, lines), encoding="utf-8")
    temp.replace(path)
    return "written"
