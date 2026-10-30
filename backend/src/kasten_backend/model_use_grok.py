"""The grok session files, read into the same messages as Claude Code's and codex's.

A session is `<sessions>/<folder>/<session>/updates.jsonl`, the folder percent-encoded.
Each prompt ends in a `turn_completed` update whose `usage.modelUsage` counts per model.
"""

import json
from datetime import datetime
from typing import TYPE_CHECKING
from urllib.parse import unquote

from kasten_backend import model_use_sessions

if TYPE_CHECKING:
    from pathlib import Path

GROK = "grok"
"""The tool a grok turn is counted under, and the name its lines carry before a slash."""


def _records(lines: list[str]) -> list[dict]:
    """The JSON objects the lines hold, a line that is no JSON object passed over."""
    found = []
    for raw in lines:
        try:
            record = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            found.append(record)
    return found


def is_grok(lines: list[str]) -> bool:
    """Whether a file is grok's: its first record is an object with a `method` and `params`."""
    for record in _records(lines):
        return "method" in record and isinstance(record.get("params"), dict)
    return False


def _day(stamp: object) -> str | None:
    """The day on this computer of a stamp in seconds since 1970, or None when it is no stamp."""
    if not isinstance(stamp, int | float) or isinstance(stamp, bool):
        return None
    try:
        return datetime.fromtimestamp(stamp).astimezone().date().isoformat()
    except OverflowError, OSError, ValueError:
        return None


def _turn(stamp: object, update: dict, cwd: str) -> list[model_use_sessions.Message]:
    """One message per model a `turn_completed` update counts, or none when it counts none."""
    usage, prompt, day = update.get("usage"), update.get("prompt_id"), _day(stamp)
    models = usage.get("modelUsage") if isinstance(usage, dict) else None
    if not (isinstance(models, dict) and isinstance(prompt, str) and prompt and day):
        return []

    count = model_use_sessions.count_of
    found = []
    for model, counts in models.items():
        if not (model and isinstance(counts, dict)):
            continue
        read = count(counts, "cachedReadTokens")
        write = count(counts, "cacheCreationTokens")
        found.append(
            model_use_sessions.Message(
                # A prompt's turn ends once, so its id and the model name the turn in any file.
                id=f"grok:{prompt}:{model}",
                model=model,
                day=day,
                cwd=cwd,
                fast=False,
                # grok counts the cached and the cache-written tokens inside inputTokens.
                input=max(0, count(counts, "inputTokens") - read - write),
                output=count(counts, "outputTokens"),
                write=write,
                read=read,
                write_5m=write,
                write_1h=0,
                tool=GROK,
                calls=max(1, count(counts, "modelCalls")),
            )
        )
    return found


def grok_messages(lines: list[str], path: Path) -> list[model_use_sessions.Message]:
    """The turns a grok file counts, in file order, one message per model of each turn."""
    # The session's folder sits two folders up, named for the folder grok ran in.
    cwd = unquote(path.parent.parent.name)
    found = []
    for record in _records(lines):
        params = record.get("params")
        update = params.get("update") if isinstance(params, dict) else None
        if isinstance(update, dict) and update.get("sessionUpdate") == "turn_completed":
            found += _turn(record.get("timestamp"), update, cwd)
    return found
