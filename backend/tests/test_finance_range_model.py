"""Spans of months, their comparisons and the budget setup, on their own.

Pure, on the accounts and categories of test_finance_budget_model.py. A span
is its months added up, so each test checks the span against its months, the
sankey of the same span, or a figure worked out by hand, with the cases a
review found before: moves between scopes, the salary cutoff at the span's
edge, refunds, `ignore` and a reserve.
"""

import datetime as dt
from decimal import Decimal

from backend.tests.test_finance_budget_model import (
    CARD,
    CONTRIBUTION,
    GIRO,
    GROCERIES,
    OCT,
    REIMBURSED,
    RENT,
    SALARY,
    SHARED,
    TRIPS,
    ledger,
    month,
)
from backend.tests.test_finance_drill_model import at
from backend.tests.test_finance_flow import flows
from kasten_backend.finance_drill import scope_month
from kasten_backend.finance_flow import month_flow
from kasten_backend.finance_free import free_to_spend
from kasten_backend.finance_plans import Book, Plan
from kasten_backend.finance_range import (
    available_in,
    category_compared,
    expected_income,
    months_of,
    scope_compared,
    scope_span,
    setup,
)

AUG, SEP, NOV = month(-2), month(-1), month(1)


def household_months():
    """Three months of mine and household: a salary each, a move into the shared account, rent."""
    lines = []
    for index in (-2, -1, 0):
        lines += [
            at(index - 1, GIRO, "3000", SALARY, late=True),
            at(index, GIRO, "-900", twin_account=SHARED),
            at(index, SHARED, "900", twin_account=GIRO),
            at(index, SHARED, "500", CONTRIBUTION),
            at(index, SHARED, "-1500", RENT),
            at(index, CARD, "-400", GROCERIES),
        ]
    # August spends past what came in on mine; the span nets it against the months after.
    lines.append(at(-2, CARD, "-2000", GROCERIES))
    return ledger(*lines)


def test_a_spans_flow_keeps_what_the_months_kept_in_all() -> None:
    book = household_months()
    flow = flows(month_flow(book, AUG, None, OCT))
    totals = {
        scope: sum((free_to_spend(book, scope, m, NOV).total for m in (AUG, SEP, OCT)), Decimal(0))
        for scope in ("mine", "household")
    }
    # Mine: 1700 left in each month, less the 2000 August spent past it.
    assert totals["mine"] == Decimal(3 * 1700 - 2000)
    assert flow["Mine", "Left over"] == totals["mine"]
    assert ("From earlier months", "Mine") not in flow
    # The move into the shared account shows once on each side, three months of it.
    assert flow["Mine", "Into household"] == flow["From mine", "Household"] == Decimal(2700)
    # Household takes in 1400 a month against 1500 of rent.
    assert flow["From earlier months", "Household"] == -totals["household"] == Decimal(300)
    for scope in ("mine", "household"):
        assert scope_span(book, scope, months_of(AUG, OCT), None).left == totals[scope]


def test_a_spans_scope_is_its_months_added_up() -> None:
    book = household_months()
    span = scope_span(book, "mine", months_of(AUG, OCT), None)
    rows = [scope_month(book, "mine", m, None) for m in (AUG, SEP, OCT)]
    assert span.month == AUG
    assert span.income == sum((r.income for r in rows), Decimal(0)) == Decimal(9000)
    assert span.flexible == Decimal(3 * 400 + 2000)
    assert span.other_scope == Decimal(2700)


def test_a_salary_after_the_cutoff_counts_in_the_span_its_budget_month_is_in() -> None:
    book = ledger(at(-1, GIRO, "3000", SALARY, late=True))
    assert scope_span(book, "mine", months_of(OCT, month(2)), None).income == Decimal(3000)
    assert scope_span(book, "mine", months_of(month(-3), SEP), None).income == 0


def test_a_span_compares_with_a_year_before_and_the_average_at_its_length() -> None:
    lines = [at(back, CARD, "-300", GROCERIES) for back in range(-6, 0)]
    lines += [at(-12, CARD, "-250", GROCERIES), at(-11, CARD, "-50", GROCERIES)]
    lines += [at(0, CARD, "-400", GROCERIES), at(1, CARD, "-100", GROCERIES)]
    book = ledger(*lines)
    found = scope_compared(book, "mine", OCT, NOV, None)
    assert found.now.flexible == Decimal(500)
    assert found.last_year.flexible == Decimal(300)
    assert found.last_year.month == month(-12)
    # The 6 months before October average 300, twice for a span of two months.
    assert found.average is not None
    assert found.average.flexible == Decimal(600)
    category = category_compared(book, GROCERIES, OCT, NOV)
    assert category.now.total == Decimal(500)
    assert category.last_year.total == Decimal(300)
    assert category.average is not None
    assert category.average.total == Decimal(600)


def test_a_span_with_no_month_before_it_has_no_average() -> None:
    book = ledger(at(0, CARD, "-40", GROCERIES))
    assert scope_compared(book, "mine", OCT, OCT, None).average is None
    assert category_compared(book, GROCERIES, OCT, OCT).average is None


def test_a_categorys_span_nets_refunds_and_an_ignored_one_counts_nothing() -> None:
    book = ledger(
        at(0, CARD, "-100", GROCERIES),
        at(1, CARD, "30", GROCERIES),
        at(0, GIRO, "-500", REIMBURSED),
        at(1, GIRO, "500", REIMBURSED),
    )
    assert category_compared(book, GROCERIES, OCT, NOV).now.total == Decimal(70)
    assert category_compared(book, REIMBURSED, OCT, NOV).now.total == 0


def test_a_spans_available_adds_each_months_limit_after_the_carried_overspend() -> None:
    book = ledger(at(0, CARD, "-150", GROCERIES), at(1, CARD, "-50", GROCERIES))
    rows = [(OCT, Decimal(100))]
    # October has 100; November 100 less October's overspend of 50.
    assert available_in(book, rows, GROCERIES, [OCT, NOV]) == Decimal(150)
    assert available_in(book, [], GROCERIES, [OCT, NOV]) is None


def test_the_setup_starts_fixed_costs_from_their_plans_and_the_rest_from_the_average() -> None:
    lines = [at(back, CARD, f"-{300 + back}", GROCERIES) for back in range(-6, 0)]
    lines += [at(back, SHARED, "-1500", RENT) for back in range(-6, 0)]
    book = ledger(*lines)
    rent = Plan(1, "Rent", SHARED, "household", RENT, Decimal(-1450), Decimal(0), 1, AUG)
    trip = Plan(2, "Trip", GIRO, "mine", TRIPS, Decimal(-1200), Decimal(0), 12, AUG)
    gone = Plan(3, "Old", GIRO, "mine", TRIPS, Decimal(-99), Decimal(0), None, AUG)
    rows = {
        row.name: row
        for row in setup(book, {RENT: [(AUG, Decimal(1500))]}, [rent, trip, gone], OCT)
    }

    assert [row.kind for row in rows.values()] == ["fixed", "flexible", "non_monthly"]
    assert rows["Rent"].limit == Decimal(1500)
    assert rows["Rent"].planned == rows["Rent"].suggested == Decimal(1450)
    # A yearly bill is a twelfth a month; a plan due once in August is not October's.
    assert rows["Trips"].planned == Decimal(100)
    assert rows["Trips"].plans == ["Trip"]
    # The average of 294.00 to 299.00 is 296.50, and the start rounds it up to the euro.
    assert rows["Groceries"].average == Decimal("296.50")
    assert rows["Groceries"].suggested == Decimal(297)


def test_expected_income_counts_household_money_from_mine_once() -> None:
    book = ledger(
        at(-1, GIRO, "3000", SALARY, late=True),
        at(0, GIRO, "-900", twin_account=SHARED),
        at(0, SHARED, "900", twin_account=GIRO),
        at(0, SHARED, "500", CONTRIBUTION),
    )
    assert expected_income(book, OCT, dt.date(2026, 10, 25), Book()) == Decimal(3500)
