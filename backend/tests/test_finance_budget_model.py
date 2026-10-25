"""The budget model on its own: scopes, the salary cutoff, free to spend, limits and suggestions.

Pure: a `Ledger` is built from lines here, with no database. The rules tested
are the ones docs/reference/budget-model.md states.
"""

import datetime as dt
from decimal import Decimal

from kasten_backend.finance_budget import budget_of, limit_in, share_of_month, unreserved
from kasten_backend.finance_free import free_to_spend
from kasten_backend.finance_ledger import Account, Category, Ledger, Line

GIRO, CARD, SAVING, SHARED, SHARED_SAVING = 1, 2, 3, 4, 5
ACCOUNTS = {
    GIRO: Account(shared=False, kind="giro"),
    CARD: Account(shared=False, kind="card"),
    SAVING: Account(shared=False, kind="saving"),
    SHARED: Account(shared=True, kind="giro"),
    SHARED_SAVING: Account(shared=True, kind="saving"),
}
SALARY, CONTRIBUTION, RENT, GROCERIES, TRIPS, SAVINGS, REIMBURSED = range(1, 8)
CATEGORIES = {
    SALARY: Category(SALARY, "Salary", "income", salary=True),
    CONTRIBUTION: Category(CONTRIBUTION, "Household contribution", "income"),
    RENT: Category(RENT, "Rent", "fixed"),
    GROCERIES: Category(GROCERIES, "Groceries", "flexible"),
    TRIPS: Category(TRIPS, "Trips", "non_monthly"),
    SAVINGS: Category(SAVINGS, "Depot", "saving"),
    REIMBURSED: Category(REIMBURSED, "Reimbursement", "ignore"),
}
OCT = dt.date(2026, 10, 1)


def month(index: int) -> dt.date:
    """The first of a month counted from October 2026: -1 is September."""
    year, rest = divmod(2026 * 12 + 9 + index, 12)
    return dt.date(year, rest + 1, 1)


def line(  # noqa: PLR0913  each field of a line is its own argument
    at: int,
    account: int,
    amount: str,
    category: int | None = None,
    *,
    twin_account: int | None = None,
    late: bool = False,
) -> Line:
    return Line(month(at), account, Decimal(amount), category, twin_account, late)


def ledger(*lines: Line) -> Ledger:
    return Ledger(list(lines), ACCOUNTS, CATEGORIES)


def parts(free_parts: list) -> dict[str, tuple[Decimal, str]]:
    return {part.name: (part.counted, part.basis) for part in free_parts}


def test_a_move_into_the_shared_account_is_a_cost_on_mine_and_income_on_household() -> None:
    book = ledger(
        line(0, GIRO, "-900", twin_account=SHARED),
        line(0, SHARED, "900", twin_account=GIRO),
        line(0, GIRO, "-300", twin_account=SAVING),
        line(0, SAVING, "300", twin_account=GIRO),
        line(0, GIRO, "-120", twin_account=CARD),
        line(0, CARD, "120", twin_account=GIRO),
        line(0, SAVING, "4.10", SALARY),
    )
    mine = free_to_spend(book, "mine", OCT, dt.date(2026, 11, 2))
    household = free_to_spend(book, "household", OCT, dt.date(2026, 11, 2))

    assert parts(mine.fixed) == {"Into the shared account": (Decimal(900), "so_far")}
    assert mine.saved == Decimal(300)
    assert mine.total == Decimal(-1200)
    assert parts(household.income) == {"From mine": (Decimal(900), "so_far")}
    assert household.total == Decimal(900)


def test_a_move_from_the_shared_account_to_its_own_savings_is_no_money() -> None:
    book = ledger(
        line(0, SHARED, "-500", twin_account=SHARED_SAVING),
        line(0, SHARED_SAVING, "500", twin_account=SHARED),
    )
    assert free_to_spend(book, "household", OCT, dt.date(2026, 11, 1)).total == 0


def test_a_salary_after_the_cutoff_counts_for_the_next_month_and_other_income_does_not() -> None:
    book = ledger(
        line(-1, GIRO, "3000", SALARY, late=True),
        line(-1, SHARED, "800", CONTRIBUTION, late=True),
    )
    october = free_to_spend(book, "mine", OCT, dt.date(2026, 10, 3))
    assert parts(october.income) == {"Salary": (Decimal(3000), "so_far")}
    september = free_to_spend(book, "household", month(-1), dt.date(2026, 10, 3))
    assert parts(september.income) == {"Household contribution": (Decimal(800), "so_far")}


def test_missing_income_counts_its_average_and_a_fixed_cost_the_larger_of_spent_and_average() -> (
    None
):
    book = ledger(
        *[line(back, GIRO, "3000", SALARY) for back in (-2, -1)],
        *[line(back, GIRO, "-1000", RENT) for back in (-2, -1)],
        line(0, GIRO, "-1050", RENT),
        line(-1, GIRO, "-200", RENT),
        line(0, GIRO, "-50", GROCERIES),
        line(0, CARD, "-20"),
        line(0, CARD, "15"),
        line(0, GIRO, "-400", TRIPS),
        line(0, GIRO, "-100", SAVINGS),
        line(0, GIRO, "-70", REIMBURSED),
        line(0, GIRO, "70", REIMBURSED),
    )
    free = free_to_spend(book, "mine", OCT, dt.date(2026, 10, 10))

    assert parts(free.income) == {"Salary": (Decimal(3000), "average")}
    assert parts(free.fixed) == {"Rent": (Decimal(1100), "average")}
    assert parts(free.flexible) == {"Groceries": (Decimal(50), "so_far")}
    assert parts(free.non_monthly) == {"Trips": (Decimal(400), "so_far")}
    assert free.unsorted == Decimal(20)
    assert free.saved == Decimal(100)
    assert free.total == Decimal(3000 - 1100 - 50 - 400 - 20 - 100)


def test_a_month_that_is_over_counts_what_happened_and_estimates_nothing() -> None:
    book = ledger(line(-2, GIRO, "-1000", RENT), line(-1, GIRO, "2000", SALARY))
    free = free_to_spend(book, "mine", month(-1), dt.date(2026, 10, 2))
    assert parts(free.income) == {"Salary": (Decimal(2000), "so_far")}
    assert parts(free.fixed) == {}


def test_a_limit_takes_effect_from_its_month_and_keeps_the_months_before() -> None:
    rows = [(month(-3), Decimal(300)), (month(-1), Decimal(250)), (OCT, None)]
    assert limit_in(rows, month(-4)) is None
    assert limit_in(rows, month(-2)) == Decimal(300)
    assert limit_in(rows, month(-1)) == Decimal(250)
    assert limit_in(rows, OCT) is None


def test_an_overspend_shrinks_next_months_limit_and_a_leftover_goes_to_unreserved() -> None:
    book = ledger(
        line(-2, GIRO, "-260", GROCERIES),
        line(-1, GIRO, "-280", GROCERIES),
        line(0, GIRO, "-100", GROCERIES),
        line(-1, GIRO, "-900", RENT),
    )
    limits = {GROCERIES: [(month(-2), Decimal(250))], RENT: [(month(-1), Decimal(1000))]}
    groceries = budget_of(book, limits, OCT, dt.date(2026, 10, 15))[0]

    # September spent 280 against its limit of 250, so October has 30 less.
    assert groceries.category.name == "Groceries"
    assert groceries.step.carried == Decimal(30)
    assert groceries.step.available == Decimal(220)
    assert unreserved(book, limits, OCT, dt.date(2026, 10, 15)).last_month == Decimal(100)
    assert unreserved(book, limits, OCT, dt.date(2026, 10, 15)).total == Decimal(100)


def test_a_steady_overspend_is_paid_back_once_a_month_and_never_grows() -> None:
    book = ledger(*[line(back, GIRO, "-150", GROCERIES) for back in range(-6, 0)])
    limits = {GROCERIES: [(month(-6), Decimal(100))]}
    steps = [
        budget_of(book, limits, month(back), dt.date(2026, 10, 1))[0].step for back in (-4, -1)
    ]
    assert [(step.carried, step.available) for step in steps] == [(50, 50), (50, 50)]


def test_an_overspend_past_the_whole_limit_leaves_nothing_but_is_not_over_until_spent() -> None:
    book = ledger(line(-1, GIRO, "-400", GROCERIES))
    limits = {GROCERIES: [(month(-1), Decimal(100))]}
    groceries = budget_of(book, limits, OCT, dt.date(2026, 10, 1))[0]
    assert (groceries.step.available, groceries.status) == (0, "ok")


def test_a_month_ahead_counts_no_leftover_of_the_month_still_running() -> None:
    book = ledger(line(0, GIRO, "-10", GROCERIES))
    limits = {GROCERIES: [(OCT, Decimal(100))]}
    ahead = unreserved(book, limits, month(2), dt.date(2026, 10, 15))
    assert (ahead.last_month, ahead.total) == (0, 0)


def test_rent_at_its_limit_is_fine_and_a_flexible_category_ahead_of_the_month_is_near() -> None:
    book = ledger(line(0, GIRO, "-1000", RENT), line(0, GIRO, "-150", GROCERIES))
    limits = {RENT: [(OCT, Decimal(1000))], GROCERIES: [(OCT, Decimal(300))]}
    by_name = {row.category.name: row for row in budget_of(book, limits, OCT, dt.date(2026, 10, 3))}

    assert by_name["Rent"].status == "ok"
    assert by_name["Groceries"].status == "near"
    assert by_name["Groceries"].expected_by_now == Decimal("29.03")
    assert by_name["Trips"].status is None


def test_a_category_over_its_limit_is_over_and_one_at_nine_tenths_is_near() -> None:
    book = ledger(line(0, GIRO, "-1001", RENT), line(0, GIRO, "-270", GROCERIES))
    limits = {RENT: [(OCT, Decimal(1000))], GROCERIES: [(OCT, Decimal(300))]}
    by_name = {
        row.category.name: row for row in budget_of(book, limits, OCT, dt.date(2026, 10, 31))
    }
    assert by_name["Rent"].status == "over"
    assert by_name["Groceries"].status == "near"


def test_three_months_of_drift_suggest_the_rounded_average_and_two_do_not() -> None:
    spending = [line(back, GIRO, "-404", GROCERIES) for back in range(-6, 0)]
    limits = {GROCERIES: [(month(-6), Decimal(300))]}

    groceries = budget_of(ledger(*spending), limits, OCT, dt.date(2026, 10, 1))[0]
    assert groceries.suggestion is not None
    assert (groceries.suggestion.direction, groceries.suggestion.amount) == ("raise", 400)

    short = budget_of(ledger(*spending[-2:]), limits, OCT, dt.date(2026, 10, 1))[0]
    assert short.suggestion is None

    fitted = {GROCERIES: [(month(-6), Decimal(300)), (OCT, Decimal(400))]}
    assert budget_of(ledger(*spending), fitted, OCT, dt.date(2026, 10, 1))[0].suggestion is None


def test_the_share_of_the_month_is_zero_before_it_and_one_after() -> None:
    assert share_of_month(OCT, dt.date(2026, 9, 30)) == 0
    assert share_of_month(OCT, dt.date(2026, 11, 1)) == 1
    assert share_of_month(OCT, dt.date(2026, 10, 31)) == 1


def test_no_suggestion_for_a_non_monthly_limit_or_down_to_nothing() -> None:
    trips = [line(back, GIRO, "-404", TRIPS) for back in range(-6, 0)]
    limits = {TRIPS: [(month(-6), Decimal(100))], GROCERIES: [(month(-6), Decimal(100))]}
    by_name = {
        row.category.name: row
        for row in budget_of(ledger(*trips), limits, OCT, dt.date(2026, 10, 1))
    }
    assert by_name["Trips"].suggestion is None
    assert by_name["Groceries"].suggestion is None


def test_a_new_category_averages_from_its_first_month_and_waits_three_for_a_suggestion() -> None:
    older = line(-18, GIRO, "-5", RENT)
    spending = [line(back, GIRO, "-400", GROCERIES) for back in (-3, -2, -1)]
    limits = {GROCERIES: [(month(-3), Decimal(300))]}

    groceries = budget_of(ledger(older, *spending), limits, OCT, dt.date(2026, 10, 1))[0]
    assert groceries.category.name == "Groceries"
    assert groceries.average == Decimal(400)
    assert groceries.suggestion is not None

    young = budget_of(ledger(older, *spending[1:]), limits, OCT, dt.date(2026, 10, 1))[0]
    assert young.average == Decimal(400)
    assert young.suggestion is None


def test_only_a_salary_and_household_money_from_mine_count_their_average_before_they_come() -> None:
    book = ledger(
        *[line(back, GIRO, "3000", SALARY) for back in (-3, -2, -1)],
        line(-2, SHARED, "1800", CONTRIBUTION),
        *[line(back, SHARED, "900", twin_account=GIRO) for back in (-3, -2, -1)],
    )
    mine = free_to_spend(book, "mine", OCT, dt.date(2026, 10, 5))
    household = free_to_spend(book, "household", OCT, dt.date(2026, 10, 5))
    assert parts(mine.income) == {"Salary": (Decimal(3000), "average")}
    assert parts(household.income) == {"From mine": (Decimal(900), "average")}
