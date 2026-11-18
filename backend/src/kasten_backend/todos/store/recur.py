"""When a repeating todo comes back: the editor's `todo-recur.ts`, held to it by one fixture.

The rules are obsidian-tasks' spellings: docs/reference/todo-format/time-and-repeats.md.
"""

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta

WEEKDAYS = ("sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday")
ORDINALS = ("1st", "2nd", "3rd", "4th")
RULE = re.compile(r"every (?:([0-9]+) )?(day|week|month|year)s?(?: on (.+))?")
LONGEST_MONTH = 31
PERIODS = 48
"""How many periods a named day is looked for before a rule is taken to have none."""


@dataclass(frozen=True)
class Rule:
    """A parsed rule. `on` is weekdays (0 is Sunday), a month day (-1 last) or an nth weekday."""

    every: int
    unit: str
    when_done: bool
    weekdays: tuple[int, ...] = ()
    day: int | None = None
    nth: tuple[int, int] | None = None


def _weekday(word: str) -> int | None:
    return next((at for at, name in enumerate(WEEKDAYS) if word in (name, name[:3])), None)


def _weekdays(text: str) -> tuple[int, ...] | None:
    days = [_weekday(word) for word in re.split(r", ?", text)]
    if any(day is None for day in days):
        return None
    return tuple(sorted({day for day in days if day is not None}, key=lambda day: (day + 6) % 7))


def _month_day(text: str) -> tuple[int | None, tuple[int, int] | None] | None:
    if text == "last":
        return -1, None
    if found := re.fullmatch(r"([0-9]{1,2})(?:st|nd|rd|th)", text):
        value = int(found[1])
        return (value, None) if 1 <= value <= LONGEST_MONTH else None
    which, _, name = text.partition(" ")
    weekday = _weekday(name)
    nth = -1 if which == "last" else (ORDINALS.index(which) + 1 if which in ORDINALS else 0)
    return None if weekday is None or nth == 0 else (None, (nth, weekday))


def parse(text: str) -> Rule | None:
    """The rule `text` spells, or None for one this cannot read."""
    words = " ".join(text.strip().lower().split())
    when_done = words.endswith(" when done")
    rule = words.removesuffix(" when done") if when_done else words
    if rule == "every weekday":
        return Rule(1, "week", when_done, weekdays=(1, 2, 3, 4, 5))
    found = RULE.fullmatch(rule)
    if found is None:
        days = _weekdays(rule.removeprefix("every ")) if rule.startswith("every ") else None
        return None if days is None else Rule(1, "week", when_done, weekdays=days)
    every, unit, named = int(found[1] or 1), found[2], found[3]
    if every < 1:
        return None
    if named is None:
        return Rule(every, unit, when_done)
    return _named(Rule(every, unit, when_done), named)


def _named(period: Rule, named: str) -> Rule | None:
    """`period` on the days `named` names, or None when they name none it can take."""
    if period.unit == "week" and (days := _weekdays(named)) is not None:
        return Rule(period.every, period.unit, period.when_done, weekdays=days)
    month = _month_day(named.removeprefix("the ")) if named.startswith("the ") else None
    if period.unit != "month" or month is None:
        return None
    return Rule(period.every, period.unit, period.when_done, day=month[0], nth=month[1])


def _js_weekday(day: date) -> int:
    return (day.weekday() + 1) % 7


def _day_in(year: int, month: int, rule: Rule) -> int | None:
    last = calendar.monthrange(year, month)[1]
    if rule.day is not None:
        return last if rule.day == -1 else (None if rule.day > last else rule.day)
    if rule.nth is None:
        return None
    nth, weekday = rule.nth
    if nth == -1:
        return last - (_js_weekday(date(year, month, last)) - weekday + 7) % 7
    return 1 + (weekday - _js_weekday(date(year, month, 1)) + 7) % 7 + (nth - 1) * 7


def next_date(day: date, rule: Rule) -> date | None:
    """The first day after `day` the rule lands on, or None when it never does."""
    if rule.weekdays:
        monday = day - timedelta(days=day.weekday())
        ahead = day + timedelta(days=1)
        while ((ahead - monday).days // 7) % rule.every or _js_weekday(ahead) not in rule.weekdays:
            ahead += timedelta(days=1)
        return ahead
    if rule.day is not None or rule.nth is not None:
        for period in range(PERIODS):
            months = day.month - 1 + period * rule.every
            year, month = day.year + months // 12, months % 12 + 1
            found = _day_in(year, month, rule)
            if found is not None and date(year, month, found) > day:
                return date(year, month, found)
        return None
    if rule.unit in ("day", "week"):
        return day + timedelta(days=rule.every * (7 if rule.unit == "week" else 1))
    months = day.month - 1 + rule.every * (1 if rule.unit == "month" else 12)
    year, month = day.year + months // 12, months % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def shift(rule_text: str, anchor: date | None, today: date) -> int | None:
    """How many days a repeat moves its dates, counted off `anchor` or today for `when done`."""
    rule = parse(rule_text)
    if rule is None or anchor is None:
        return None
    found = next_date(today if rule.when_done else anchor, rule)
    return None if found is None else (found - anchor).days
