"""Firefly's Auto-categorize triggers as kasten rules: kinds, cleaning, repeats and refusals."""

from kasten_jobs.firefly import Trigger
from kasten_jobs.firefly_rules import translate

GROCERIES = Trigger("Auto: Groceries", "destination_account_contains", "REWE", "Groceries")


def test_the_rules_translate_by_trigger_and_refuse_what_they_cannot():
    triggers = [
        GROCERIES,
        Trigger("Auto: Groceries", "destination_account_contains", "DM.DROGERIE", "Groceries"),
        Trigger("Auto: Groceries", "destination_account_contains", "dm-drogerie", "Groceries"),
        Trigger("Auto: Reimbursement", "source_account_contains", "rewe", "Reimbursement"),
        Trigger("Auto: Dining", "destination_account_contains", "Rewe", "Dining"),
        Trigger("Auto: Dining", "description_contains", " Lieferando ", "Dining"),
        Trigger("Auto: Post", "destination_account_contains", "Deutsche.Post", None),
        Trigger("Auto: Dining", "amount_less", "10", "Dining"),
        Trigger("Auto: Dining", "description_contains", "--", "Dining"),
    ]

    out = translate(triggers)

    assert [(r.kind, r.pattern, r.category, r.side) for r in out.rules] == [
        ("payee", "rewe", "Groceries", "out"),
        ("payee", "dm drogerie", "Groceries", "out"),
        ("payee", "rewe", "Reimbursement", "in"),
        ("text_contains", "lieferando", "Dining", "out"),
    ]
    assert out.merged == 1
    assert [rule for rule, _ in out.refused] == [
        "Auto: Dining",
        "Auto: Post",
        "Auto: Dining",
        "Auto: Dining",
    ]
