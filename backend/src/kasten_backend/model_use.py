"""Write Claude Code's tokens and cost per day, model and project into the vault's monthly notes.

`python -m kasten_backend.model_use <source> <vault> [--from] [--to] [--config]`
reads every session file under `<source>`, prices each message at the config
note's rows, and writes the months the days from `--from` to `--to` touch. The
format is in docs/reference/model-use-format.md.
"""

import argparse
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from kasten_backend.config import DEFAULTS
from kasten_backend.model_use_config import CONFIG_NOTE, Config, read_config
from kasten_backend.model_use_notes import months, note_path, write_month
from kasten_backend.model_use_sessions import read_messages, usage_lines

BUNDLED = Path(__file__).parent / "model-use.md"
"""The price table the package ships, read when the vault holds no config note of its own."""


def _config(vault: Path, config_path: str) -> tuple[Config, list[str]]:
    """The config note's prices and folders, else the bundled ones, with a line saying which."""
    path = vault / config_path / CONFIG_NOTE
    if path.is_file():
        return read_config(path.read_text(encoding="utf-8")), []
    notice = f"No {CONFIG_NOTE} in {config_path}: using the bundled prices of {BUNDLED}"
    return read_config(BUNDLED.read_text(encoding="utf-8")), [notice]


def run(  # noqa: PLR0913, PLR0917  each part of a run is its own argument
    source: Path, vault: Path, config_path: str, first: date, last: date, now: datetime
) -> list[str]:
    """Collect the days from `first` to `last` into the vault, and name each note it touched."""
    config, notices = _config(vault, config_path)
    report = [*notices, *config.skipped]
    start, end = first.isoformat(), last.isoformat()
    usages = usage_lines(read_messages(source), config, start, end)
    for month in months(first, last):
        path = note_path(vault, config_path, month)
        fresh = [usage for usage in usages if usage.day[:7] == month]
        outcome = write_month(path, month, fresh, start, end, now)
        if outcome:
            report.append(f"{outcome} {path.relative_to(vault).as_posix()}")
    return report


def main(argv: list[str] | None = None) -> int:
    """Run the collector from the command line, printing a line per note and skipped config line."""
    parser = argparse.ArgumentParser(description="Collect Claude Code usage into model-use notes.")
    parser.add_argument("source", type=Path, help="the folder of session files, any depth")
    parser.add_argument("vault", type=Path, help="the vault the notes are written into")
    parser.add_argument("--from", dest="start", type=date.fromisoformat, help="first day")
    parser.add_argument("--to", dest="end", type=date.fromisoformat, help="last day")
    parser.add_argument("--config", default=DEFAULTS.config_path, help="config folder in the vault")
    args = parser.parse_args(argv)

    today = date.today()
    first = args.start or today - timedelta(days=1)
    last = args.end or today
    if first > last:
        parser.error("--from is after --to")

    for line in run(args.source, args.vault, args.config, first, last, datetime.now(UTC)):
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
