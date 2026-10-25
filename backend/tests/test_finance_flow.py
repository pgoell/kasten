"""Where a month's money went: the flow agrees with free to spend and folds small streams.

Pure, on the ledger and the accounts of test_finance_budget_model.py.
"""

import datetime as dt
from decimal import Decimal

from backend.tests.test_finance_budget_model import (
    ACCOUNTS,
    CARD,
    CATEGORIES,
    CONTRIBUTION,
    GIRO,
    GROCERIES,
    OCT,
    RENT,
    SALARY,
    SAVING,
    SHARED,
    TRIPS,
    ledger,
    line,
)
from kasten_backend.finance_flow import Flow, month_flow
from kasten_backend.finance_free import free_to_spend
from kasten_backend.finance_ledger import Category, Ledger

NOVEMBER = dt.date(2026, 11, 1)


def flows(flow: Flow) -> dict[tuple[str, str], Decimal]:
    names = {node.key: node.name for node in flow.nodes}
    return {(names[link.source], names[link.target]): link.amount for link in flow.links}


def balance(flow: Flow, key: str) -> tuple[Decimal, Decimal]:
    """What comes into a node and what goes out of it."""
    into = sum((link.amount for link in flow.links if link.target == key), Decimal(0))
    out = sum((link.amount for link in flow.links if link.source == key), Decimal(0))
    return into, out


def october() -> Ledger:
    return ledger(
        line(-1, GIRO, "3000", SALARY, late=True),
        line(0, GIRO, "-900", twin_account=SHARED),
        line(0, SHARED, "900", twin_account=GIRO),
        line(0, GIRO, "-300", twin_account=SAVING),
        line(0, SHARED, "800", CONTRIBUTION),
        line(0, SHARED, "-2000", RENT),
        line(0, GIRO, "-400", GROCERIES),
        line(0, CARD, "-50", GROCERIES),
        line(0, CARD, "20", GROCERIES),
        line(0, CARD, "-25"),
    )


def test_each_scope_takes_in_what_it_gives_out_and_keeps_free_to_spend_as_left_over() -> None:
    book = october()
    flow = month_flow(book, OCT)

    for scope in ("mine", "household"):
        into, out = balance(flow, scope)
        free = free_to_spend(book, scope, OCT, NOVEMBER)
        assert into == out
        name = "Mine" if scope == "mine" else "Household"
        left = flows(flow).get((name, "Left over"), Decimal(0))
        taken = flows(flow).get(("From earlier months", name), Decimal(0))
        assert left - taken == free.total
    assert flows(flow) == {
        ("Salary", "Mine"): Decimal(3000),
        ("Mine", "Into household"): Decimal(900),
        ("Mine", "Saved"): Decimal(300),
        ("Mine", "Flexible"): Decimal(430),
        ("Flexible", "Groceries"): Decimal(430),
        ("Mine", "Not sorted"): Decimal(25),
        ("Mine", "Left over"): Decimal(3000 - 900 - 300 - 430 - 25),
        ("From mine", "Household"): Decimal(900),
        ("Household contribution", "Household"): Decimal(800),
        ("Household", "Fixed"): Decimal(2000),
        ("Fixed", "Rent"): Decimal(2000),
        ("From earlier months", "Household"): Decimal(300),
    }
    assert flow.total == Decimal(3000 + 900 + 800 + 300)


def test_the_flow_counts_what_happened_so_far_not_the_average() -> None:
    book = ledger(
        *[line(back, SHARED, "-1000", RENT) for back in (-2, -1)],
        line(0, SHARED, "500", CONTRIBUTION),
    )
    flow = month_flow(book, OCT)
    assert ("Fixed", "Rent") not in flows(flow)
    assert flows(flow)[("Household", "Left over")] == Decimal(500)


def test_a_refund_past_the_months_spending_and_savings_drawn_on_come_in() -> None:
    book = ledger(
        line(0, GIRO, "60", GROCERIES),
        line(0, GIRO, "500", twin_account=SAVING),
    )
    found = flows(month_flow(book, OCT))
    assert found[("Groceries refunded", "Mine")] == Decimal(60)
    assert found[("From saving", "Mine")] == Decimal(500)
    assert found[("Mine", "Left over")] == Decimal(560)


def test_small_categories_fold_into_other_of_their_kind_but_never_one_alone() -> None:
    names = {
        10: Category(10, "Books", "flexible"),
        11: Category(11, "Coffee", "flexible"),
        12: Category(12, "Gym", "fixed"),
    }
    book = Ledger(
        [
            line(0, GIRO, "3000", SALARY),
            line(0, GIRO, "-40", 10),
            line(0, GIRO, "-30", 11),
            line(0, GIRO, "-20", 12),
            line(0, GIRO, "-1000", TRIPS),
        ],
        ACCOUNTS,
        CATEGORIES | names,
    )
    found = flows(month_flow(book, OCT))
    assert found[("Flexible", "Other flexible")] == Decimal(70)
    assert found[("Fixed", "Gym")] == Decimal(20)
    assert found[("Non-monthly", "Trips")] == Decimal(1000)
