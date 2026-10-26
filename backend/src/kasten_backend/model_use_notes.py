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
        if separator and name == key:
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


def _values(ident: str, created: str, modified: str) -> dict[str, str]:
    """The frontmatter fields the collector sets, in the order it writes them."""
    return {
        "id": ident,
        "created": created,
        "modified": modified,
        "type": "Reference",
        "generator": GENERATOR,
    }


def _front(front: list[str], values: dict[str, str]) -> list[str]:
    """The frontmatter lines: the collector's fields set, every other line as it was, in order."""
    lines, written = [], set()
    for line in front:
        # Only a line with no leading space is a field: an indented one belongs to the field above.
        key = line.partition(":")[0]
        if key not in values:
            lines.append(line)
        elif key not in written:
            lines.append(f"{key}: {values[key]}")
            written.add(key)
    lines += [f"{key}: {value}" for key, value in values.items() if key not in written]
    return lines


def _render(front: list[str], body: list[str]) -> str:
    """The whole note: its frontmatter block, then the body."""
    return "\n".join([FENCE, *front, FENCE, *body]) + "\n"


def _usage_entries(body: list[str], fresh: list[Usage]) -> list[tuple[Usage, str]]:
    """The usage lines to write, as (usage, text), sorted by day, tool, model and project.

    A day and tool the run counted has its old lines replaced by the fresh ones, so
    a codex run leaves a day's Claude Code lines alone. Any other body line keeps its
    text, so it is written back byte for byte: a day with no message in the source
    keeps what it had.
    """
    counted = {(usage.day, usage.tool) for usage in fresh}
    entries = []
    for line in body:
        usage = parse_line(line)
        if usage is not None and (usage.day, usage.tool) not in counted:
            entries.append((usage, line))
    entries += [(usage, format_line(usage)) for usage in fresh]
    return sorted(
        entries, key=lambda entry: (entry[0].day, entry[0].tool, entry[0].model, entry[0].project)
    )


def _body(month: str, entries: list[tuple[Usage, str]], foreign: list[str]) -> list[str]:
    """The body: heading, sentence, the usage lines, then the lines the collector did not write."""
    lines = [heading(month), "", SENTENCE]
    if entries:
        lines += ["", *(line for _, line in entries)]
    if foreign:
        lines += ["", *foreign]
    return lines


def write_month(path: Path, month: str, fresh: list[Usage], now: datetime) -> str:
    """Write a month's note with the `fresh` lines, one day at a time (see `_usage_entries`).

    Returns `written`, `unchanged` or `left alone`, or an empty string when there is
    nothing to write and no note to write it into. A note that is not ours, or does
    not decode as UTF-8, is left alone. Everything the collector did not write stays,
    frontmatter included. A write goes to a hidden file beside the note and is renamed
    over it, so a broken run leaves the old note.
    """
    try:
        text = path.read_text(encoding="utf-8") if path.is_file() else None
    except UnicodeDecodeError:
        return "left alone"
    if text is None and not fresh:
        return ""
    if text is not None and _field(_split(text)[0], "generator") != GENERATOR:
        return "left alone"

    stamp = now.isoformat(timespec="seconds")
    front, body = _split(text or "")
    lines = _body(month, _usage_entries(body, fresh), _foreign(body, month))
    ident = _field(front, "id") or str(uuid7())
    created = _field(front, "created") or stamp
    # The same bytes as the file means nothing changed, so the file keeps its mtime too.
    held = _field(front, "modified") or stamp
    if text is not None and _render(_front(front, _values(ident, created, held)), lines) == text:
        return "unchanged"

    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(_render(_front(front, _values(ident, created, stamp)), lines), encoding="utf-8")
    temp.replace(path)
    return "written"
