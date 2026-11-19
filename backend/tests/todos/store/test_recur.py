"""The store's repeat rules (#2191), held to the editor's by one fixture."""

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from kasten_backend.todos.store import recur

RECURS = json.loads((Path(__file__).parents[2] / "fixtures/todo_recur.json").read_text("utf-8"))


@pytest.mark.parametrize("case", RECURS, ids=[f"{c['rule']} from {c['date']}" for c in RECURS])
def test_a_repeat_lands_where_the_editor_lands_it(case: dict[str, Any]) -> None:
    """The cases `frontend/tests/todo-recur.test.ts` runs too."""
    rule = recur.parse(case["rule"])
    found = None if rule is None else recur.next_date(date.fromisoformat(case["date"]), rule)

    assert (None if rule is None else rule.when_done) == case["whenDone"]
    assert (None if found is None else found.isoformat()) == case["next"]


def test_when_done_counts_off_today_and_moves_by_the_gap_from_the_anchor() -> None:
    assert recur.shift("every week when done", date(2026, 11, 1), date(2026, 11, 18)) == 24
    assert recur.shift("every week", date(2026, 11, 1), date(2026, 11, 18)) == 7
    assert recur.shift("every week", None, date(2026, 11, 18)) is None
