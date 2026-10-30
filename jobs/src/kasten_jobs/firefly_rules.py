"""Firefly's Auto-categorize triggers turned into kasten rules, and the ones that do not turn.

Source and destination triggers both become payee rules, told apart by the rule's
side; where they still differ, the import's hand step puts the category back.
"""

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Mapping

    from kasten_jobs.firefly import Trigger

KIND = {
    "Salary": "income",
    "Interest": "income",
    "Reimbursement": "income",
    "Household contribution": "income",
    "Housing": "fixed",
    "Utilities": "fixed",
    "Telecom": "fixed",
    "Insurance & memberships": "fixed",
    "Subs (AI/tech)": "fixed",
    "Subs (personal)": "fixed",
    "Investments": "saving",
    "Wedding": "non_monthly",
    "Travel": "non_monthly",
    "Gifts (given)": "non_monthly",
}
"""Each Firefly category's kind; the others are `flexible`. The owner may change them in kasten."""

KINDS = {
    "destination_account_contains": "payee",
    "source_account_contains": "payee",
    "description_contains": "text_contains",
}


def clean_pattern(kind: str, pattern: str) -> str:
    """The pattern as kasten stores it, the same as `finance_sorting.clean_pattern`.

    Kept the same so a second import finds its rules and posts none again.
    """
    lowered = pattern.lower()
    if kind == "payee":
        return " ".join(re.findall(r"[^\W_]+", lowered))
    return lowered.strip()


@dataclass(frozen=True)
class Rule:
    """A kasten rule to post: its kind, its stored pattern, its category's name and side.

    `in` for an income category, `out` for the rest. A pattern is unique per kind and side.
    """

    kind: str
    pattern: str
    category: str
    side: str


@dataclass
class Translation:
    """The rules to post, and per Firefly trigger that made none, why."""

    rules: list[Rule] = field(default_factory=list)
    merged: int = 0
    """Triggers that cleaned to a rule made already for their category: `Onlyfans`, `OnlyFans`."""
    refused: list[tuple[str, str]] = field(default_factory=list)
    """(rule title, reason) for each trigger left out."""


def translate(triggers: list[Trigger], kinds: Mapping[str, str] = KIND) -> Translation:
    """Each trigger as a rule, in Firefly's order; of two clashing patterns the first wins.

    A category `kinds` does not name is `flexible`.
    """
    out = Translation()
    made: dict[tuple[str, str, str], str] = {}
    for trigger in triggers:
        kind = KINDS.get(trigger.type)
        if kind is None:
            out.refused.append((trigger.rule, f"trigger {trigger.type} has no kasten rule"))
            continue
        if trigger.category is None:
            out.refused.append((trigger.rule, "its set_category action is off"))
            continue
        pattern = clean_pattern(kind, trigger.value)
        if not re.search(r"[^\W_]", pattern):
            out.refused.append((trigger.rule, "the pattern has no letter or digit"))
            continue
        side = "in" if kinds.get(trigger.category, "flexible") == "income" else "out"
        earlier = made.get((kind, pattern, side))
        if earlier == trigger.category:
            out.merged += 1
        elif earlier is not None:
            out.refused.append((trigger.rule, f"the {kind} pattern already sorts to {earlier}"))
        else:
            made[kind, pattern, side] = trigger.category
            out.rules.append(Rule(kind, pattern, trigger.category, side))
    return out
