"""Made-up session records and config notes for the model-use tests. No test reads a real file.

The collector tests and the note tests both write these, so they live here
rather than in one test module, which would then pass the file-size limit.
"""

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

KASTEN = "/home/pascal/Code/kasten"
CONFIG = "99 Misc/01 Config"
NOTE = f"{CONFIG}/Model use/2026-10.md"
STAMP = "2026-10-25T10:00:00Z"
PRICES = (
    "## Prices\n"
    "- claude-opus-5-5: input 4, output 20, cache write 5m 5, cache write 1h 8, cache read 0.2\n"
    "- claude-opus-5-5 fast: input 8, output 40, cache write 5m 10, cache write 1h 16, "
    "cache read 0.4\n"
    "- claude-haiku-5-5: input 0.1, output 0.5, cache write 5m 0.125, cache write 1h 0.2, "
    "cache read 0.01\n"
    "- claude-haiku-5-5 over 100000: input 0.5, output 2.5, cache write 5m 0.625, "
    "cache write 1h 1, cache read 0.05\n"
    "- claude-haiku-4-5: input 1, output 5, cache write 5m 1.25, cache write 1h 2, cache read 0.1\n"
    "\n## Projects\n- /home/pascal/Code/kasten: kasten\n"
)


def usage(input=0, output=0, write=0, read=0, **extra) -> dict:
    """A message's usage as Claude Code writes it, with any extra fields."""
    return {
        "input_tokens": input,
        "output_tokens": output,
        "cache_creation_input_tokens": write,
        "cache_read_input_tokens": read,
        **extra,
    }


def record(mid: str, usage: dict | None = None, **fields) -> str:
    """One session record, a line of a file.

    `model`, `cwd`, `stamp` and `kind` change the defaults; None drops the field.
    """
    message = {"id": mid, "model": fields.get("model", "claude-opus-5-5")}
    if usage is not None:
        message["usage"] = usage
    body = {"type": fields.get("kind", "assistant"), "message": message}
    cwd, stamp = fields.get("cwd", KASTEN), fields.get("stamp", STAMP)
    if cwd is not None:
        body["cwd"] = cwd
    if stamp is not None:
        body["timestamp"] = stamp
    return json.dumps(body)


def session(root: Path, name: str, *lines: str) -> None:
    """Write a session file of these record lines at `name` under `root`."""
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def config(vault: Path, text: str = PRICES) -> None:
    """Write the config note under the vault's config folder."""
    (vault / CONFIG).mkdir(parents=True, exist_ok=True)
    (vault / CONFIG / "model-use.md").write_text(text, encoding="utf-8")


def snapshot(vault: Path, skip: str = "") -> dict[Path, bytes]:
    """Every file under the vault with its bytes, but the one at `skip`."""
    return {
        path: path.read_bytes()
        for path in vault.rglob("*")
        if path.is_file() and path.relative_to(vault).as_posix() != skip
    }


def usage_lines(vault: Path) -> list[str]:
    """The usage lines of the October note, as written."""
    text = (vault / NOTE).read_text(encoding="utf-8")
    return [line for line in text.split("\n") if line.startswith("- ")]
