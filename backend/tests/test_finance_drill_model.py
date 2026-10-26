"""The drilldowns' figures on their own, and that they agree with free to spend and the sankey.

Pure, on the accounts and categories of test_finance_budget_model.py. Each
money case a review found before has its own test: moves between own
accounts, mine against household, the salary cutoff, splits, refunds,
`ignore` and a bill a plan's reserve paid.
"""

import datetime as dt
from decimal import Decimal

from backend.tests.test_finance_budget_model import (
    CARD,
    GIRO,
    GROCERIES,
    OCT,
    REIMBURSED,
    RENT,
    SALARY,
    SAVING,
    SHARED,
    TRIPS,
    ledger,
    month,
)
from backend.tests.test_finance_flow import NOVEMBER, flows, october
from kasten_backend.finance_budget import average_spent
from kasten_backend.finance_drill import (
    account_flow,
    balance_on,
    booking_months,
    by_payee,
    category_months,
    counted,
    counts,
    of_category,
    payee_view,
    scope_month,
)
from kasten_backend.finance_flow import month_flow
from kasten_backend.finance_free import free_to_spend
from kasten_backend.finance_ledger import Category, Line
from kasten_backend.finance_plans import Book, Plan

SEP = month(-1)
REWE, BOSS, ME = 1, 2, 3


def at(index: int, account: int, amount: str, category: int | None = None, **fields) -> Line:
    """A line of month `index` from October 2026, with a payee and the rest as `fields`."""
    return Line(month(index), account, Decimal(amount), category, **fields)


def test_a_scopes_month_is_the_sankeys_streams_and_its_left_is_free_to_spend() -> None:
    book = october()
    flow = flows(month_flow(book, OCT))
    mine = scope_month(book, "mine", OCT, None)
    household = scope_month(book, "household", OCT, None)

    # The salary booked late in September counts in October, as the sankey has it.
    assert mine.income == flow["Salary", "Mine"] == Decimal(3000)
    assert mine.other_scope == flow["Mine", "Into household"] == Decimal(900)
    assert mine.saved == flow["Mine", "Saved"]
    assert mine.flexible == flow["Mine", "Flexible"] == Decimal(430)
    assert mine.unsorted == flow["Mine", "Not sorted"]
    assert mine.left == flow["Mine", "Left over"]
    assert household.other_scope == flow["From mine", "Household"] == Decimal(900)
    assert household.fixed == flow["Household", "Fixed"]
    assert household.left == -flow["From earlier months", "Household"]
    for scope, row, sign in (("mine", mine, -1), ("household", household, 1)):
        assert row.left == free_to_spend(book, scope, OCT, NOVEMBER).total
        spent = row.fixed + row.flexible + row.non_monthly + row.reserved + row.saved
        assert row.left == row.income + sign * row.other_scope - spent - row.unsorted


def test_a_move_inside_mine_counts_in_no_part_of_the_scope() -> None:
    book = ledger(
        at(0, GIRO, "-120", twin_account=CARD),
        at(0, CARD, "120", twin_account=GIRO),
    )
    row = scope_month(book, "mine", OCT, None)
    assert (row.income, row.other_scope, row.saved, row.unsorted, row.left) == (0, 0, 0, 0, 0)


def test_a_category_counts_its_refunds_net_and_both_scopes_like_the_budget() -> None:
    book = ledger(
        at(0, GIRO, "-400", GROCERIES),
        at(0, CARD, "-50", GROCERIES),
        at(0, CARD, "20", GROCERIES),
        at(0, SHARED, "-100", GROCERIES),
    )
    found = counted(of_category(book, GROCERIES), GROCERIES, OCT)
    assert (found.mine, found.household) == (Decimal(430), Decimal(100))
    assert found.total == book.spent(OCT, GROCERIES)
    # The sankey's category node gathers both scopes' streams into it.
    node = next(n for n in month_flow(book, OCT).nodes if n.key == f"category-{GROCERIES}")
    assert node.amount == found.total


def test_a_category_shows_the_limit_and_average_the_budget_tab_shows() -> None:
    book = ledger(*[at(back, GIRO, "-300", GROCERIES) for back in (-2, -1, 0)])
    rows = [(month(-2), Decimal(250))]
    found = category_months(book, rows, GROCERIES, [month(-1), OCT])
    assert [m.counted.total for m in found] == [Decimal(300), Decimal(300)]
    assert [m.limit for m in found] == [Decimal(250), Decimal(250)]
    # September's overspend of 50 comes off October.
    assert found[-1].available == Decimal(200)
    assert found[-1].average == Decimal(300) == average_spent(book, GROCERIES, OCT)


def test_an_income_categorys_average_is_of_its_money_in() -> None:
    book = ledger(*[at(back, GIRO, "3000", SALARY) for back in (-2, -1, 0)])
    found = category_months(book, [], SALARY, [OCT])
    assert found[0].counted.total == Decimal(3000)
    assert found[0].average == Decimal(3000)


def test_an_ignored_category_and_money_in_without_one_count_nothing() -> None:
    book = ledger(
        at(0, GIRO, "-500", REIMBURSED, payee=BOSS),
        at(0, GIRO, "500", REIMBURSED, payee=BOSS),
        at(0, GIRO, "80", payee=BOSS),
    )
    assert counted(of_category(book, REIMBURSED), REIMBURSED, OCT).total == 0
    view = payee_view(book, BOSS, [OCT])
    assert (view.months[0].spent, view.months[0].received) == (0, 0)
    assert view.categories == {}


def test_a_bill_its_reserve_paid_counts_in_the_category_and_says_so() -> None:
    trip = Plan(1, "Trip", GIRO, "mine", TRIPS, Decimal(-1200), Decimal(0), 12, OCT, confirmed=OCT)
    plans = Book(plans=[trip], matched={(1, OCT)}, paid={(1, OCT): Decimal(1300)})
    book = ledger(at(0, GIRO, "3000", SALARY), at(0, GIRO, "-1300", TRIPS, reserved=True))
    found = counted(of_category(book, TRIPS), TRIPS, OCT)
    assert found.total == book.spent(OCT, TRIPS) == Decimal(1300)
    assert found.from_reserve == Decimal(1300)
    # The sankey draws the bill as reserved, so its category stream is what is left.
    assert ("Non-monthly", "Trips") not in flows(month_flow(book, OCT, plans))
    row = scope_month(book, "mine", OCT, plans)
    assert row.reserved == flows(month_flow(book, OCT, plans))["Mine", "Reserved"]
    assert row.non_monthly == found.total - found.from_reserve == 0


def test_a_salary_after_the_cutoff_counts_for_the_payee_in_the_next_month() -> None:
    book = ledger(at(-1, GIRO, "3000", SALARY, late=True, payee=BOSS))
    view = payee_view(book, BOSS, [SEP, OCT])
    assert [m.received for m in view.months] == [Decimal(0), Decimal(3000)]
    assert view.categories == {SALARY: Decimal(3000)}


def test_a_payees_moves_between_own_accounts_are_never_spending() -> None:
    book = ledger(
        at(0, GIRO, "-120", twin_account=CARD, payee=ME),
        at(0, GIRO, "-900", twin_account=SHARED, payee=ME),
        at(0, SHARED, "900", twin_account=GIRO, payee=ME),
        at(0, GIRO, "-300", twin_account=SAVING, payee=ME),
    )
    view = payee_view(book, ME, [OCT])
    assert view.months[0].spent == 0
    assert view.months[0].received == 0
    assert view.months[0].saved == Decimal(300)


def test_a_payees_spending_and_the_categories_it_went_to_add_up() -> None:
    book = ledger(
        at(-1, GIRO, "-60", GROCERIES, payee=REWE),
        at(0, GIRO, "-40", GROCERIES, payee=REWE),
        at(0, GIRO, "15", GROCERIES, payee=REWE),
        at(0, CARD, "-10", payee=REWE),
        at(0, GIRO, "-500", GROCERIES, payee=BOSS),
    )
    view = payee_view(book, REWE, [SEP, OCT])
    assert [m.spent for m in view.months] == [Decimal(60), Decimal(35)]
    assert view.categories == {GROCERIES: Decimal(85)}
    assert view.average == Decimal(60)
    # The payees of a category add up to what it counted, one with none included.
    payees = by_payee(book, GROCERIES, [OCT])
    assert payees == {REWE: Decimal(25), BOSS: Decimal(500)}
    assert sum(payees.values()) == counted(of_category(book, GROCERIES), GROCERIES, OCT).total


def test_a_split_counts_in_each_of_its_categories_under_its_bookings_payee() -> None:
    # A split's lines carry their own category and their booking's payee.
    book = ledger(
        at(0, GIRO, "-70", GROCERIES, payee=REWE),
        at(0, GIRO, "-30", RENT, payee=REWE),
    )
    assert by_payee(book, GROCERIES, [OCT]) == {REWE: Decimal(70)}
    assert payee_view(book, REWE, [OCT]).categories == {GROCERIES: Decimal(70), RENT: Decimal(30)}


def test_an_accounts_flow_adds_up_to_what_its_bookings_moved_with_transfers_apart() -> None:
    lines = [
        at(0, GIRO, "3000", SALARY, late=True),
        at(0, GIRO, "-400", GROCERIES),
        at(0, GIRO, "-900", twin_account=SHARED),
        at(0, GIRO, "-25"),
        at(-1, GIRO, "-999", GROCERIES),
        at(0, CARD, "-50", GROCERIES),
    ]
    flow = account_flow(lines, GIRO, OCT, OCT)
    # By booking date: the late salary booked in October stays in October here.
    assert dict(flow.categories) == {SALARY: 3000, GROCERIES: -400, None: -25}
    assert dict(flow.transfers) == {SHARED: -900}
    assert flow.net == Decimal(3000 - 400 - 900 - 25)


def test_a_balance_counts_from_the_nearest_bank_balance_and_holds_its_days_bookings() -> None:
    day = dt.date
    snapshots = [(day(2026, 10, 10), Decimal(1000))]
    daily = [(day(2026, 9, 30), Decimal(-50)), (day(2026, 10, 10), Decimal(-20))]
    daily += [(day(2026, 10, 20), Decimal(-100))]
    assert balance_on(day(2026, 10, 31), snapshots, daily) == (Decimal(900), day(2026, 10, 10))
    assert balance_on(day(2026, 10, 10), snapshots, daily) == (Decimal(1000), day(2026, 10, 10))
    # Before the first bank balance, the bookings between are taken off it.
    assert balance_on(day(2026, 9, 30), snapshots, daily) == (Decimal(1020), day(2026, 10, 10))
    assert balance_on(day(2026, 10, 31), [], daily) == (Decimal(-170), None)


def test_a_booking_lists_in_the_month_it_counts_in() -> None:
    names = {SALARY: Category(SALARY, "Salary", "income", salary=True)}
    late = dt.date(2026, 9, 20)
    assert booking_months(late, [(Decimal(3000), SALARY)], names, 15) == {OCT}
    assert booking_months(late, [(Decimal(-30), SALARY)], names, 15) == {SEP}
    assert booking_months(late, [(Decimal(3000), None)], names, 15) == {SEP}
    assert booking_months(dt.date(2026, 9, 15), [(Decimal(3000), SALARY)], names, 15) == {SEP}
    split = [(Decimal(2000), SALARY), (Decimal(1000), None)]
    assert booking_months(late, split, names, 15) == {SEP, OCT}


def test_a_booking_says_where_it_counts_and_a_move_inside_a_scope_counts_nowhere() -> None:
    assert counts(ledger(at(0, GIRO, "-120", twin_account=CARD))) == []
    into = counts(ledger(at(0, GIRO, "-900", twin_account=SHARED)))
    assert [(c.scope, c.part, c.amount) for c in into] == [("mine", "other_scope", 900)]
    salary = counts(ledger(at(-1, GIRO, "3000", SALARY, late=True)))
    assert [(c.month, c.part, c.category) for c in salary] == [(OCT, "income", SALARY)]
    paid = counts(ledger(at(0, GIRO, "-1300", TRIPS, reserved=True)))
    assert [(c.part, c.amount) for c in paid] == [("reserve", 1300)]
