"""The codex session files, read into the same messages as Claude Code's.

Codex writes a `turn_context` record before each turn, with the model and the
folder, and a `token_count` event after each model call, with that call's counts.
`model_use_sessions` hands a file here when its first record is a `session_meta`.
"""

import json
from datetime import datetime

from kasten_backend import model_use_sessions

CODEX = "codex"
"""The tool a codex call is counted under, and the name its lines carry before a slash."""


def _record(raw: str) -> dict | None:
    """The JSON object a line holds, or None when the line is no JSON object."""
    try:
        record = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return record if isinstance(record, dict) else None


def _text(value: object) -> str:
    """The value when it is a string, else the empty string."""
    return value if isinstance(value, str) else ""


def is_codex(lines: list[str]) -> bool:
    """Whether a file is codex's: its first record that parses is a `session_meta`."""
    for raw in lines:
        record = _record(raw)
        if record is not None:
            return record.get("type") == "session_meta"
    return False


def _call(
    stamp: object, info: object, model: str, cwd: str
) -> tuple[int, model_use_sessions.Message] | None:
    """The call a token_count event counts, with its running total, or None when it counts none."""
    if not (isinstance(stamp, str) and isinstance(info, dict) and model and cwd):
        return None
    last, total = info.get("last_token_usage"), info.get("total_token_usage")
    if not (isinstance(last, dict) and isinstance(total, dict)):
        return None
    try:
        when = datetime.fromisoformat(stamp)
    except ValueError:
        return None

    count = model_use_sessions.count_of
    cached = count(last, "cached_input_tokens")
    write = count(last, "cache_write_input_tokens")
    tokens = count(total, "total_tokens")
    message = model_use_sessions.Message(
        # The stamp and the running total name the call, so a copy in another file is the same call.
        id=f"codex:{stamp}:{tokens}",
        model=model,
        day=when.astimezone().date().isoformat(),
        cwd=cwd,
        fast=False,
        # OpenAI counts the cached tokens inside input_tokens, so the rest is what is left.
        input=max(0, count(last, "input_tokens") - cached),
        output=count(last, "output_tokens"),
        write=write,
        read=cached,
        write_5m=write,
        write_1h=0,
        tool=CODEX,
    )
    return tokens, message


def codex_messages(lines: list[str]) -> list[model_use_sessions.Message]:
    """The calls a codex file counts, in file order, one per `token_count` event that has counts.

    An event is passed over when no model is known yet, or when its running total
    is the total of the call counted before it: codex writes the same event again.
    """
    session_cwd = turn_cwd = model = ""
    last_total: int | None = None
    found = []
    for raw in lines:
        record = _record(raw)
        if record is None or not isinstance(record.get("payload"), dict):
            continue
        payload, kind = record["payload"], record.get("type")
        if kind == "session_meta":
            session_cwd = _text(payload.get("cwd")) or session_cwd
        elif kind == "turn_context":
            # A turn that names no folder keeps the last one named, and the session's before that.
            model = _text(payload.get("model")) or model
            turn_cwd = _text(payload.get("cwd")) or turn_cwd
        elif kind == "event_msg" and payload.get("type") == "token_count":
            counted = _call(
                record.get("timestamp"), payload.get("info"), model, turn_cwd or session_cwd
            )
            if counted is None or counted[0] == last_total:
                continue
            last_total = counted[0]
            found.append(counted[1])
    return found
