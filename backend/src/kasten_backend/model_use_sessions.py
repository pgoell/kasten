"""The Claude Code session files, read into one usage per day, model and project.

Claude Code writes one record per block of an answer, each carrying the answer's
usage, and a resumed session copies earlier records into its new file. So a
message is counted once, by its id, however many records or files carry it.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from kasten_backend.model_use_config import Config, Price, price_of, project_of
from kasten_backend.model_use_lines import Usage

if TYPE_CHECKING:
    from pathlib import Path

SYNTHETIC = "<synthetic>"
"""The model Claude Code names on a message it wrote itself, which was never priced."""


@dataclass(frozen=True)
class Message:
    """One assistant message as its session file holds it, the counts already read."""

    id: str
    model: str
    day: str
    cwd: str
    fast: bool
    input: int
    output: int
    write: int
    read: int
    write_5m: int
    write_1h: int


def _count(usage: dict, key: str) -> int:
    """The count under `key`, or 0 when it is missing or not a whole number."""
    value = usage.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _message(record: object) -> Message | None:
    """The message a session record holds, or None when the record is not a countable one."""
    if not isinstance(record, dict) or record.get("type") != "assistant":
        return None

    message = record.get("message")
    if not isinstance(message, dict):
        return None
    mid, model, usage = message.get("id"), message.get("model"), message.get("usage")
    cwd, stamp = record.get("cwd"), record.get("timestamp")
    if not (
        isinstance(mid, str)
        and mid
        and isinstance(model, str)
        and model not in ("", SYNTHETIC)
        and isinstance(usage, dict)
        and isinstance(cwd, str)
        and cwd
        and isinstance(stamp, str)
    ):
        return None

    try:
        when = datetime.fromisoformat(stamp)
    except ValueError:
        return None

    # A cache write is priced by how long it is kept, read off `cache_creation` when the
    # record has it. A record without it prices every cache write at the 5-minute rate.
    write = _count(usage, "cache_creation_input_tokens")
    cache = usage.get("cache_creation")
    write_5m, write_1h = write, 0
    if isinstance(cache, dict):
        write_5m = _count(cache, "ephemeral_5m_input_tokens")
        write_1h = _count(cache, "ephemeral_1h_input_tokens")

    return Message(
        id=mid,
        model=model,
        # The day of the instant on this computer, which is the day the user lived it on.
        day=when.astimezone().date().isoformat(),
        cwd=cwd,
        fast=usage.get("speed") == "fast",
        input=_count(usage, "input_tokens"),
        output=_count(usage, "output_tokens"),
        write=write,
        read=_count(usage, "cache_read_input_tokens"),
        write_5m=write_5m,
        write_1h=write_1h,
    )


def read_messages(source: Path) -> dict[str, Message]:
    """Every countable message under `source`, once each by id.

    Of the records that carry one id, the one with the most output tokens is the
    one kept. The first seen keeps a tie, so the order of the files decides nothing.
    """
    found: dict[str, Message] = {}
    for path in sorted(source.rglob("*.jsonl")):
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                record = json.loads(raw)
            except json.JSONDecodeError:
                continue
            message = _message(record)
            if message is None:
                continue
            held = found.get(message.id)
            if held is None or message.output > held.output:
                found[message.id] = message
    return found


@dataclass
class _Sum:
    """The running totals of one day, model and project."""

    input: int = 0
    output: int = 0
    write: int = 0
    read: int = 0
    cost: float = 0.0
    priced: int = 0
    unpriced: int = 0

    def add(self, message: Message, row: Price | None) -> None:
        """Count one message; its tokens go to the cost when a row prices it, else to unpriced."""
        self.input += message.input
        self.output += message.output
        self.write += message.write
        self.read += message.read
        if row is None:
            self.unpriced += message.input + message.output + message.write + message.read
            return
        self.priced += 1
        self.cost += (
            message.input * row.input
            + message.output * row.output
            + message.write_5m * row.write_5m
            + message.write_1h * row.write_1h
            + message.read * row.read
        ) / 1_000_000


def usage_lines(messages: dict[str, Message], config: Config, first: str, last: str) -> list[Usage]:
    """One usage per day, model and project of the messages from `first` to `last`, both ends in.

    A message whose folder names no project is passed over.
    """
    sums: dict[tuple[str, str, str], _Sum] = {}
    for message in messages.values():
        if not first <= message.day <= last:
            continue
        project = project_of(message.cwd, config.folders)
        if not project:
            continue
        prompt = message.input + message.write + message.read
        row = price_of(message.model, message.fast, prompt, config.prices)
        sums.setdefault((message.day, message.model, project), _Sum()).add(message, row)

    usages = []
    for day, model, project in sorted(sums):
        total = sums[day, model, project]
        usages.append(
            Usage(
                day=day,
                model=model,
                project=project,
                input=total.input,
                output=total.output,
                cache_write=total.write,
                cache_read=total.read,
                cost=total.cost if total.priced else None,
                unpriced=total.unpriced,
            )
        )
    return usages
