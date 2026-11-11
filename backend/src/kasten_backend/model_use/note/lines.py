"""The usage line, written and read back in one shape.

A line holds one day, model and project: the tokens of its messages and what
they cost. The collector writes it and the year review reads it, so both import
the same format, and a line that reads back here is one both sides agree on.
"""

import re
from dataclasses import dataclass

CLAUDE_CODE = "claude-code"
"""The tool of a line whose model has no tool before it. Claude Code's lines are written so."""

LINE = re.compile(
    r"^- (\d{4}-\d{2}-\d{2}) (\S+) ([^:]+): in (\d+), out (\d+), cache write (\d+), "
    r"cache read (\d+), cost (?:(\d+\.\d{4}) usd|unknown)(?:, unpriced (\d+))?$"
)


@dataclass(frozen=True)
class Usage:
    """One day, tool, model and project: the token counts, the cost, and the tokens with no price.

    `cost` is None when no message of the group had a price, and then `unpriced`
    is every token of the group. Never a cost of 0 for a group that had no price.
    """

    day: str
    model: str
    project: str
    input: int
    output: int
    cache_write: int
    cache_read: int
    cost: float | None
    unpriced: int
    tool: str = CLAUDE_CODE


def format_line(usage: Usage) -> str:
    """The line a usage is written as, cost to four decimals."""
    # A model of another tool carries its tool before a slash, `codex/gpt-6-astra`.
    model = usage.model if usage.tool == CLAUDE_CODE else f"{usage.tool}/{usage.model}"
    head = (
        f"- {usage.day} {model} {usage.project}: in {usage.input}, out {usage.output}, "
        f"cache write {usage.cache_write}, cache read {usage.cache_read}, "
    )
    if usage.cost is None:
        return head + "cost unknown"
    # The suffix is left off when every message was priced, so a clean line reads as it always did.
    suffix = f", unpriced {usage.unpriced}" if usage.unpriced else ""
    return f"{head}cost {usage.cost:.4f} usd{suffix}"


def parse_line(line: str) -> Usage | None:
    """The usage a line holds, or None when the line is not one the collector writes."""
    found = LINE.match(line)
    if found is None:
        return None

    day, group, project, tokens_in, out, write, read, cost, unpriced = found.groups()
    head, slash, rest = group.partition("/")
    tool, model = (head, rest) if slash else (CLAUDE_CODE, group)
    counts = [int(tokens_in), int(out), int(write), int(read)]
    # A line that says `cost unknown` has no priced tokens, so all of them are unpriced.
    leftover = sum(counts) if cost is None else int(unpriced or 0)
    return Usage(
        day=day,
        model=model,
        project=project,
        input=counts[0],
        output=counts[1],
        cache_write=counts[2],
        cache_read=counts[3],
        cost=None if cost is None else float(cost),
        unpriced=leftover,
        tool=tool,
    )
