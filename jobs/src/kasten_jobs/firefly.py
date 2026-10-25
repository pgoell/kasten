"""Firefly III's database, read and never written: the accounts, journals, categories and rules.

The import (`firefly_import`) needs only these, as plain records, so the tests
build the records by hand and no test needs a Firefly schema.
"""

import json
from dataclasses import dataclass
from datetime import date  # noqa: TC003  a dataclass field, read at runtime
from decimal import Decimal  # noqa: TC003  a dataclass field, read at runtime

import psycopg

JOURNAL_NOTE = "FireflyIII\\Models\\TransactionJournal"
"""`notes.noteable_type` of a journal's note; notes also hang on bills and piggy banks."""


@dataclass(frozen=True)
class Account:
    """A Firefly account of any type: asset, expense, revenue."""

    id: int
    name: str
    type: str
    iban: str | None
    role: str | None
    """`account_role` from account_meta on an asset account: `defaultAsset`, `ccAsset` and so on."""


@dataclass(frozen=True)
class Leg:
    """One of a journal's two transaction rows: an account and its signed amount."""

    account_id: int
    amount: Decimal


@dataclass(frozen=True)
class Journal:
    """One Firefly booking, a withdrawal, deposit or transfer, with what hangs on it."""

    id: int
    type: str
    date: date
    description: str
    external_id: str | None
    notes: str | None
    category: str | None
    budget: str | None
    bill: str | None
    tags: tuple[str, ...]
    legs: tuple[Leg, ...]


@dataclass(frozen=True)
class Trigger:
    """One trigger of an Auto-categorize rule, with the category the rule sets.

    `category` is None when the rule's set_category action is switched off.
    """

    rule: str
    type: str
    value: str
    category: str | None


@dataclass(frozen=True)
class Firefly:
    """Everything the import reads."""

    accounts: dict[int, Account]
    journals: list[Journal]
    categories: list[str]
    triggers: list[Trigger]


ACCOUNTS = """
SELECT a.id, a.name, t.type, NULLIF(a.iban, ''),
       (SELECT m.data FROM account_meta m WHERE m.account_id = a.id AND m.name = 'account_role')
FROM accounts a JOIN account_types t ON t.id = a.account_type_id
WHERE a.deleted_at IS NULL
"""

LEGS = """
SELECT transaction_journal_id, account_id, amount FROM transactions
WHERE deleted_at IS NULL ORDER BY id
"""

# Opening balances are left out: kasten takes balances from the bank's
# snapshots, never from a sum of bookings.
JOURNALS = """
SELECT j.id, tt.type, j.date::date, j.description,
       (SELECT m.data FROM journal_meta m WHERE m.transaction_journal_id = j.id
          AND m.name = 'external_id' AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1),
       (SELECT n.text FROM notes n WHERE n.noteable_id = j.id AND n.noteable_type = %s
          AND n.deleted_at IS NULL ORDER BY n.id LIMIT 1),
       (SELECT c.name FROM category_transaction_journal x JOIN categories c ON c.id = x.category_id
          WHERE x.transaction_journal_id = j.id AND c.deleted_at IS NULL ORDER BY c.id LIMIT 1),
       (SELECT b.name FROM budget_transaction_journal x JOIN budgets b ON b.id = x.budget_id
          WHERE x.transaction_journal_id = j.id AND b.deleted_at IS NULL ORDER BY b.id LIMIT 1),
       bill.name,
       ARRAY(SELECT t.tag FROM tag_transaction_journal x JOIN tags t ON t.id = x.tag_id
          WHERE x.transaction_journal_id = j.id AND t.deleted_at IS NULL ORDER BY t.tag)
FROM transaction_journals j
JOIN transaction_types tt ON tt.id = j.transaction_type_id
LEFT JOIN bills bill ON bill.id = j.bill_id
WHERE j.deleted_at IS NULL AND tt.type IN ('Withdrawal', 'Deposit', 'Transfer')
ORDER BY j.date, j.id
"""

CATEGORIES = "SELECT name FROM categories WHERE deleted_at IS NULL ORDER BY name"

# Only the Auto-categorize group: Auto-budget copies category to budget, and
# Subscriptions links bills, both of which kasten does otherwise. Every rule
# there fires on any one trigger (strict off), so each trigger is a rule of
# its own in kasten. `user_action` is when a rule fires, not what it matches.
TRIGGERS = """
SELECT r.title, rt.trigger_type, rt.trigger_value,
       (SELECT a.action_value FROM rule_actions a WHERE a.rule_id = r.id
          AND a.action_type = 'set_category' AND a.active ORDER BY a."order" LIMIT 1)
FROM rules r
JOIN rule_groups g ON g.id = r.rule_group_id
JOIN rule_triggers rt ON rt.rule_id = r.id
WHERE g.title = 'Auto-categorize' AND g.deleted_at IS NULL AND r.deleted_at IS NULL
  AND r.active AND rt.active AND rt.trigger_type <> 'user_action'
ORDER BY r."order", r.id, rt."order", rt.id
"""


def _meta(data: str | None) -> str | None:
    # Firefly stores every meta value JSON-encoded, a string in quotes.
    return None if data is None else json.loads(data)


def read(url: str) -> Firefly:
    """Read Firefly through a read-only session, so no statement here can change it."""
    with psycopg.connect(url) as connection:
        connection.read_only = True
        accounts = {
            row[0]: Account(row[0], row[1], row[2], row[3], _meta(row[4]))
            for row in connection.execute(ACCOUNTS)
        }
        legs: dict[int, list[Leg]] = {}
        for journal_id, account_id, amount in connection.execute(LEGS):
            legs.setdefault(journal_id, []).append(Leg(account_id, amount))
        journals = [
            Journal(
                *row[:4],
                external_id=_meta(row[4]),
                notes=row[5],
                category=row[6],
                budget=row[7],
                bill=row[8],
                tags=tuple(row[9]),
                legs=tuple(legs.get(row[0], ())),
            )
            for row in connection.execute(JOURNALS, (JOURNAL_NOTE,))
        ]
        categories = [row[0] for row in connection.execute(CATEGORIES)]
        triggers = [Trigger(*row) for row in connection.execute(TRIGGERS)]
    return Firefly(accounts, journals, categories, triggers)
