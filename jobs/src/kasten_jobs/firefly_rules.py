"""Firefly's Auto-categorize triggers turned into kasten rules, and the ones that do not turn.

Firefly matched an account name or a description as a substring. Kasten's
`payee` rule matches from the start of a word of the cleaned payee key, so a
fragment such as `Lebensversic` still sorts `Lebensversicherung`, and its
`text_contains` rule a substring of the purpose, which is Firefly's
description. So an account trigger becomes a payee rule and a description
trigger a text rule. Firefly's source and destination triggers both become
payee rules: kasten tells them apart by the category's kind, an income rule
sorting only money in, and lets one pattern sort each side. Where the two
still differ, the import's hand step puts Firefly's category back on the
history.
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
"""Each Firefly category's kind; every other one is `flexible`. The owner changes them in kasten."""

KINDS = {
    "destination_account_contains": "payee",
    "source_account_contains": "payee",
    "description_contains": "text_contains",
}


def clean_pattern(kind: str, pattern: str) -> str:
    """The pattern as kasten stores it, the same as `finance_sorting.clean_pattern`.

    Computed here so a second import finds its rules among kasten's and posts
    none again.
    """
    lowered = pattern.lower()
    if kind == "payee":
        return " ".join(re.findall(r"[^\W_]+", lowered))
    return lowered.strip()


@dataclass(frozen=True)
class Rule:
    """A kasten rule to post: its kind, its pattern as stored, its category's name, and its side.

    `side` is the bookings kasten lets the rule sort: `in` for an income
    category, `out` for the rest. A pattern is unique per kind and side.
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
    """Each trigger as a rule, in Firefly's order, the first of two clashing patterns winning.

    `kinds` gives each category's kind, from which a rule's side follows; a
    category it does not name is `flexible`.
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
