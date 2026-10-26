"""The config note of the model-use collector: its prices and its project folders.

Only the `- ` lines under `## Prices` and `## Projects` are read; every other line
is free text, so the note can say where its prices came from. A `- ` line there
that breaks the format is named rather than guessed at, so a typo in one price
never quietly prices a model at nothing.
"""

import re
from dataclasses import dataclass

CONFIG_NOTE = "model-use.md"
"""The file name, in the config folder, that holds the prices and the projects."""

_RATE = r"\d+(?:\.\d+)?"
_HEAD = re.compile(r"^(\S+)( fast)?( over (\d+))?$")
_RATES = re.compile(
    rf"^input ({_RATE}), output ({_RATE}), cache write 5m ({_RATE}), "
    rf"cache write 1h ({_RATE}), cache read ({_RATE})$"
)
_FOLDER = re.compile(r"^(/.+?): (.+)$")
DATE_SUFFIX = re.compile(r"\d{8}")
"""The date a dated model id ends with, such as `20251001`."""


@dataclass(frozen=True)
class Price:
    """One price row: a model's five rates in US dollars per million tokens."""

    model: str
    fast: bool
    over: int | None
    input: float
    output: float
    write_5m: float
    write_1h: float
    read: float


@dataclass(frozen=True)
class Config:
    """The rows and folders the note holds, and the named lines it could not read."""

    prices: list[Price]
    folders: list[tuple[str, str]]
    skipped: list[str]


def _name(text: str) -> str:
    """A project name as a line can hold it: no colon, the ends trimmed."""
    # A colon would end the project early in a usage line, so it is dropped here.
    return text.replace(":", "").strip()


def _price(body: str) -> Price | None:
    """The row a `- ` line's text after the dash sets, or None when the text breaks the format."""
    head, separator, rates = body.partition(": ")
    named = _HEAD.match(head)
    rated = _RATES.match(rates)
    if not separator or named is None or rated is None:
        return None

    return Price(
        model=named[1],
        fast=named[2] is not None,
        over=int(named[4]) if named[4] else None,
        input=float(rated[1]),
        output=float(rated[2]),
        write_5m=float(rated[3]),
        write_1h=float(rated[4]),
        read=float(rated[5]),
    )


def _folder(body: str) -> tuple[str, str] | None:
    """The folder and project name a `- ` line's text sets, or None when it sets neither."""
    found = _FOLDER.match(body)
    if found is None:
        return None

    folder, name = found[1].rstrip("/"), _name(found[2])
    if not folder or not name:
        return None
    return folder, name


def read_config(text: str) -> Config:
    """Read the note's price rows and project folders, naming each `- ` line that breaks."""
    prices: list[Price] = []
    folders: list[tuple[str, str]] = []
    skipped: list[str] = []
    section = ""
    for number, raw in enumerate(text.split("\n"), 1):
        line = raw.rstrip("\r")
        if line.startswith("## "):
            section = line.rstrip()
            continue
        if not line.startswith("- ") or section not in ("## Prices", "## Projects"):
            continue

        if section == "## Prices":
            price = _price(line[2:])
            if price is not None:
                prices.append(price)
                continue
        else:
            folder = _folder(line[2:])
            if folder is not None:
                folders.append(folder)
                continue
        skipped.append(f"Skipped line {number} of {CONFIG_NOTE}: {line}")
    return Config(prices=prices, folders=folders, skipped=skipped)


def project_of(cwd: str, folders: list[tuple[str, str]]) -> str:
    """The project of a folder: the longest mapped folder holding it, else its last name.

    A folder with no last name, `/` for one, counts under the folder as written, so
    the message is not dropped.
    """
    trimmed = cwd.rstrip("/")
    held = [
        (folder, name)
        for folder, name in folders
        if trimmed == folder or trimmed.startswith(folder + "/")
    ]
    if held:
        return max(held, key=lambda pair: len(pair[0]))[1]
    return _name(trimmed.rsplit("/", 1)[-1]) or _name(cwd)


def _takes(model: str, row_model: str) -> bool:
    """Whether a row named `row_model` prices `model`: the same name, or that name and a date.

    A dated id such as `claude-haiku-4-5-20251001` takes its name's row. Any other
    suffix is a model of its own, `claude-opus-5-6` for one, and has no row until a
    line names it.
    """
    if model == row_model:
        return True
    return (
        model.startswith(row_model + "-")
        and DATE_SUFFIX.fullmatch(model.removeprefix(row_model + "-")) is not None
    )


def price_of(model: str, fast: bool, prompt: int, prices: list[Price]) -> Price | None:
    """The row that prices one message, or None when no row can take it.

    The model is found first: the row named the same, else the longest name that
    a `-` follows in the id, so `claude-haiku-4-5` prices `claude-haiku-4-5-20251001`.
    Then the kind. A fast message takes only a fast row and never falls back to a
    plain one. A plain message takes the `over` row with the highest N below its
    prompt, else the plain row.
    """
    names = [row.model for row in prices if _takes(model, row.model)]
    if not names:
        return None

    name = max(names, key=len)
    rows = [
        row
        for row in prices
        if row.model == name and row.fast == fast and (row.over is None or prompt > row.over)
    ]
    over = [row for row in rows if row.over is not None]
    if over:
        return max(over, key=lambda row: row.over or 0)
    return next((row for row in rows if row.over is None), None)
