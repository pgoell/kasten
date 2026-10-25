"""Plans and goals on their own: due dates, matching, reserves, goal contributions, proposals.

Pure, with no database, like test_finance_budget_model.py, whose ledger
helpers these share. The rules are the ones docs/reference/budget-model.md
states.
"""

import datetime as dt
from decimal import Decimal

from backend.tests.test_finance_budget_model import (
    GIRO,
    GROCERIES,
    OCT,
    RENT,
    SALARY,
    SAVING,
    TRIPS,
    ledger,
    line,
    month,
)
from kasten_backend.finance_free import free_to_spend
from kasten_backend.finance_ledger import Line
from kasten_backend.finance_plans import (
    Book,
    Booking,
    GoalPlan,
    Plan,
    due_dates,
    forecast,
    match,
    monthly_need,
    shares_until,
)
from kasten_backend.finance_proposals import Seen, every_of, proposals

TODAY = dt.date(2026, 10, 10)


def plan(  # noqa: PLR0913  each field the tests vary is its own argument
    id_: int = 1,
    amount: str = "-900",
    every: int | None = 1,
    start: dt.date = dt.date(2026, 1, 1),
    category: int | None = RENT,
    *,
    end: dt.date | None = None,
    payee: int | None = 7,
    text: str | None = None,
) -> Plan:
    return Plan(
        id_, f"Plan {id_}", GIRO, "mine", category, Decimal(amount), Decimal(5), every, start,
        end, payee, text,
    )  # fmt: skip


def test_a_date_past_a_short_month_s_end_falls_on_its_last_day() -> None:
    dates = due_dates(plan(start=dt.date(2026, 1, 31)), dt.date(2026, 1, 1), dt.date(2026, 4, 30))
    assert dates == [
        dt.date(2026, 1, 31),
        dt.date(2026, 2, 28),
        dt.date(2026, 3, 31),
        dt.date(2026, 4, 30),
    ]


def test_a_plan_ends_on_its_end_and_a_once_plan_falls_due_once() -> None:
    ending = plan(every=3, end=dt.date(2026, 7, 1))
    assert due_dates(ending, dt.date(2025, 1, 1), dt.date(2027, 1, 1)) == [
        dt.date(2026, 1, 1),
        dt.date(2026, 4, 1),
        dt.date(2026, 7, 1),
    ]
    assert due_dates(plan(every=None), dt.date(2025, 1, 1), dt.date(2027, 1, 1)) == [
        dt.date(2026, 1, 1)
    ]


def booking(id_: int, day: dt.date, amount: str, payee: int | None = 7, text: str = "") -> Booking:
    return Booking(id_, GIRO, day, Decimal(amount), payee, text)


def test_a_booking_matches_in_the_month_it_falls_due_by_payee_or_text_within_the_tolerance() -> (
    None
):
    rent, gym = plan(1), plan(2, "-30", payee=None, text="FitX")
    found = match(
        [rent, gym],
        [
            booking(10, dt.date(2026, 1, 3), "-903"),
            booking(11, dt.date(2026, 2, 1), "-990"),  # past the tolerance
            booking(12, dt.date(2026, 2, 27), "-900"),
            booking(13, dt.date(2026, 3, 2), "-30", None, "fitx berlin"),
        ],
        matched={(1, dt.date(2026, 3, 1))},
    )
    assert found == [
        (1, dt.date(2026, 1, 1), 10),
        (1, dt.date(2026, 2, 1), 12),
        (2, dt.date(2026, 3, 1), 13),
    ]


def test_of_two_bookings_the_one_nearest_the_date_matches_and_each_matches_once() -> None:
    found = match(
        [plan(1, start=dt.date(2026, 1, 15)), plan(2, start=dt.date(2026, 1, 15))],
        [booking(10, dt.date(2026, 1, 2), "-900"), booking(11, dt.date(2026, 1, 14), "-900")],
        matched=set(),
    )
    assert found == [(1, dt.date(2026, 1, 1), 11), (2, dt.date(2026, 1, 1), 10)]


def test_a_yearly_plan_sets_aside_twelve_shares_up_to_its_bill() -> None:
    insurance = plan(amount="-600", every=12, start=dt.date(2027, 3, 1))
    assert insurance.share == Decimal(50)
    assert shares_until(insurance, dt.date(2026, 3, 1)) == 0
    assert shares_until(insurance, dt.date(2026, 4, 1)) == 1
    assert shares_until(insurance, dt.date(2027, 3, 1)) == 12


def test_free_to_spend_takes_the_share_and_the_bill_comes_out_of_the_reserve() -> None:
    trip = plan(1, "-1200", every=12, start=OCT, category=TRIPS)
    book = Book(plans=[trip], matched={(1, OCT)}, paid={(1, OCT): Decimal(1200)})
    paid = Line(month(0), GIRO, Decimal(-1200), TRIPS, reserved=True)
    free = free_to_spend(ledger(line(0, GIRO, "3000", SALARY), paid), "mine", OCT, TODAY, book)
    assert free.non_monthly == []
    assert free.reserved == Decimal(100)
    assert free.reserves[0].balance == Decimal(0)
    assert free.total == Decimal(2900)
    # The budget tab still sees what the category spent.
    assert ledger(paid).spent(OCT, TRIPS) == Decimal(1200)


def test_a_fixed_category_with_a_plan_counts_what_it_cost_and_its_dates_still_to_come() -> None:
    book = Book(plans=[plan(1, "-900"), plan(2, "-50", start=dt.date(2026, 1, 20))])
    book.matched.add((1, OCT))
    lines = [line(back, GIRO, "-2000", RENT) for back in (-2, -1)] + [line(0, GIRO, "-900", RENT)]
    free = free_to_spend(ledger(*lines), "mine", OCT, TODAY, book)
    assert [(p.name, p.counted, p.basis) for p in free.fixed] == [("Rent", Decimal(950), "plan")]
    # Without plans the average of 2000 would have counted.
    assert free_to_spend(ledger(*lines), "mine", OCT, TODAY).fixed[0].counted == Decimal(2000)


def test_a_goal_takes_its_contribution_until_it_has_moved_and_not_twice() -> None:
    goal = GoalPlan(1, "House", SAVING, "Saving", Decimal(500), dt.date(2028, 1, 1), reached=False)
    book = Book(goals=[goal])
    moved = line(0, GIRO, "-200", twin_account=SAVING)
    free = free_to_spend(ledger(line(0, GIRO, "3000", SALARY), moved), "mine", OCT, TODAY, book)
    assert (free.saved, free.to_move) == (Decimal(200), Decimal(300))
    assert free.total == Decimal(2500)
    assert not free.goals[0].done
    after = free_to_spend(ledger(moved), "mine", OCT, dt.date(2026, 11, 2), book)
    assert after.to_move == 0


def test_the_need_spreads_what_is_left_over_the_months_to_the_due_month() -> None:
    need = monthly_need(Decimal(6000), Decimal(1000), dt.date(2027, 3, 1), TODAY)
    assert need == Decimal(1000)


def test_the_forecast_adds_the_plans_still_to_come_to_the_bank_balance() -> None:
    pay = plan(1, "3000", payee=None, text="Lohn", category=SALARY)
    rent = plan(2, "-900")
    book = Book(plans=[pay, rent, plan(3, "-40", category=GROCERIES)], matched={(1, OCT)})
    months = forecast(book, "mine", Decimal(1000), OCT, 2)
    assert [m.balance for m in months] == [Decimal(60), Decimal(2120)]


def seen(day: dt.date, amount: str, payee: int | None = 3, bill: str | None = None) -> Seen:
    return Seen(day, Decimal(amount), GIRO, payee, "Netflix", "NETFLIX", GROCERIES, bill)


def test_proposals_read_firefly_bills_and_payees_paid_monthly_leaving_out_planned_ones() -> None:
    assert every_of([dt.date(2026, 1, 5), dt.date(2027, 1, 4)]) == 12
    assert every_of([dt.date(2026, 1, 5), dt.date(2026, 1, 12)]) is None
    history = [
        seen(dt.date(2025, 3, 2), "-480", 9, "Haftpflicht"),
        seen(dt.date(2026, 3, 1), "-492", 9, "Haftpflicht"),
        *(seen(dt.date(2026, m, 15), "-13.99") for m in range(5, 11)),
        *(seen(dt.date(2026, m, 15), "-55", payee=4) for m in (8, 9, 10)),
    ]
    found = proposals(history, TODAY, planned={(4, GIRO)}, names=set())
    assert [(p.source, p.name, p.every, p.amount, p.tolerance) for p in found] == [
        ("bill", "Haftpflicht", 12, Decimal("-486.00"), Decimal(6)),
        ("payee", "Netflix", 1, Decimal("-13.99"), Decimal(0)),
    ]
