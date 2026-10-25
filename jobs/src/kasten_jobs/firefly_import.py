"""The one-shot import of Firefly III's history into kasten, through the finance routes only.

Reads Firefly read-only, then makes the categories, the rules, the accounts and
the bookings, runs the rules once, and sets by hand every category Firefly
holds that the rules do not give. Every step looks before it writes, so a
second run changes nothing. See docs/how-to/import-from-firefly-iii.md and
docs/reference/firefly-import.md.
"""

import argparse
import logging
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal
from typing import TYPE_CHECKING, Any

import httpx

from kasten_jobs import firefly
from kasten_jobs.firefly_rules import translate
from kasten_jobs.kasten_api import KastenApi

if TYPE_CHECKING:
    from kasten_jobs.firefly import Account, Firefly, Journal

log = logging.getLogger("kasten_jobs.firefly_import")

CENT = Decimal("0.01")

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

ROLE_KIND = {
    "defaultAsset": "giro",
    "sharedAsset": "giro",
    "savingAsset": "saving",
    "ccAsset": "card",
    "cashWalletAsset": "cash",
}

NO_NAME = {"Unknown payee", "Unknown source"}
"""The accounts Firefly books against when the bank named no counterparty."""

IBAN = re.compile(r"IBAN:\s*([A-Z0-9]+)")


def account_in(account: Account) -> dict[str, Any]:
    """The account as `POST /api/finance/accounts` takes it. The bank is its name's first word."""
    return {
        "name": account.name,
        "bank": account.name.split()[0] if account.iban else None,
        "iban": account.iban,
        "kind": ROLE_KIND[account.role or "defaultAsset"],
        "shared": account.role == "sharedAsset",
    }


def _raw(journal: Journal) -> dict[str, Any]:
    keep = ("id", "type", "external_id", "category", "budget", "bill", "notes")
    return {"firefly": {**{k: getattr(journal, k) for k in keep}, "tags": list(journal.tags)}}


@dataclass(frozen=True)
class Booking:
    """One booking to post, and the Firefly journal it came from."""

    journal: Journal
    body: dict[str, Any]


def bookings(ff: Firefly, ids: dict[int, int]) -> list[Booking]:
    """A booking per journal on each asset account it touches, so a transfer gives two.

    `ids` maps a Firefly asset account to its kasten id. The key is Firefly's
    `external_id` as it stands, never recomputed, plus `:n`, the journal's
    place among those on the same account with the same `external_id`, by
    date and then id. A journal with no `external_id` is keyed by its id.
    """
    seen: Counter[tuple[int, str]] = Counter()
    out = []
    for journal in sorted(ff.journals, key=lambda j: (j.date, j.id)):
        for leg in journal.legs:
            if leg.account_id not in ids:
                continue
            other = next(ff.accounts[o.account_id] for o in journal.legs if o is not leg)
            prefix = journal.external_id or f"firefly:{journal.id}"
            n = seen[leg.account_id, prefix]
            seen[leg.account_id, prefix] += 1
            if other.id in ids:
                # A move between own accounts: the other account's IBAN is what
                # kasten's linker pairs the two halves by.
                iban = other.iban
            else:
                found = IBAN.search(journal.notes or "")
                iban = found and found.group(1)
            body = {
                "account_id": ids[leg.account_id],
                "booking_date": str(journal.date),
                "value_date": str(journal.date),
                "amount": str(leg.amount.quantize(CENT)),
                "purpose": journal.description,
                "counterparty_name": None if other.name in NO_NAME else other.name,
                "counterparty_iban": iban,
                "raw": _raw(journal),
                "source_key": f"{prefix}:{n}",
            }
            out.append(Booking(journal, body))
    return out


@dataclass
class Report:
    """What a run did or, dry, would do. Counts only: no booking is ever printed."""

    counts: dict[str, int] = field(default_factory=dict)
    per_account: Counter[str] = field(default_factory=Counter)
    refused: list[tuple[str, str]] = field(default_factory=list)

    def print(self) -> None:
        """Log every count, then each rule left out."""
        for name, value in self.counts.items():
            log.info("%s: %d", name, value)
        for account, value in sorted(self.per_account.items()):
            log.info("bookings on %s: %d", account, value)
        for rule, reason in self.refused:
            log.info("rule not translated: %s (%s)", rule, reason)


def used_categories(ff: Firefly) -> list[str]:
    """The Firefly categories a journal or a translated rule names; an unused one stays behind."""
    named = {j.category for j in ff.journals} | {r.category for r in translate(ff.triggers).rules}
    return [name for name in ff.categories if name in named]


def plan(ff: Firefly) -> tuple[Report, list[Booking]]:
    """What Firefly holds, counted, and the bookings with stand-in account ids."""
    assets = [a for a in ff.accounts.values() if a.type == "Asset account"]
    made = bookings(ff, {a.id: a.id for a in assets})
    rules = translate(ff.triggers)
    report = Report(refused=rules.refused)
    report.per_account = Counter(ff.accounts[b.body["account_id"]].name for b in made)
    report.counts = {
        "accounts": len(assets),
        "journals": len(ff.journals),
        "bookings": len(made),
        "transfers": sum(j.type == "Transfer" for j in ff.journals),
        "journals without external_id": sum(not j.external_id for j in ff.journals),
        "twins (n > 0)": sum(not b.body["source_key"].endswith(":0") for b in made),
        "with a counterparty IBAN": sum(bool(b.body["counterparty_iban"]) for b in made),
        "with a Firefly category": sum(bool(j.category) for j in ff.journals),
        "categories": len(ff.categories),
        "categories in use": len(used_categories(ff)),
        "rule triggers": len(ff.triggers),
        "rules translated": len(rules.rules),
        "triggers merged into one rule": rules.merged,
        "triggers not translated": len(rules.refused),
    }
    return report, made


def run(ff: Firefly, api: KastenApi) -> Report:
    """Import everything, looking before each write, and answer what was done."""
    report, _ = plan(ff)
    c = report.counts
    c["categories created"] = c["rules created"] = 0
    categories = {row["name"]: row["id"] for row in api.categories()}
    for name in used_categories(ff):
        if name not in categories:
            categories[name] = api.post_category(name, KIND.get(name, "flexible"))["id"]
            c["categories created"] += 1
    # Rules before bookings, so each rule's run over every booking is cheap
    # and the ingest sorts the bookings as they come in.
    stored = {(row["kind"], row["pattern"]) for row in api.rules()}
    for rule in translate(ff.triggers).rules:
        if (rule.kind, rule.pattern) not in stored:
            api.post_rule(rule.kind, rule.pattern, categories[rule.category])
            c["rules created"] += 1
    assets = [a for a in ff.accounts.values() if a.type == "Asset account"]
    ids = {a.id: api.post_account(account_in(a))["id"] for a in assets}
    made = bookings(ff, ids)
    c["bookings created"], c["bookings already there"] = api.post_bookings([b.body for b in made])
    c["rules run changed"] = api.run_rules()
    _by_hand(api, made, categories, c)
    return report


def _by_hand(api: KastenApi, made: list[Booking], categories: dict[str, int], c: dict) -> None:
    """Set Firefly's category by hand wherever the rules gave another or none.

    Where Firefly had none and a rule gives one, the rule's stays: kasten has
    no "none by hand", and sorting that backlog is what the rules are for.
    """
    rows = {(row["account_id"], row["source_key"]): row for row in api.bookings()}
    for name in ("set by hand", "already as in Firefly", "on a transfer", "sorted by a rule only"):
        c[f"categories {name}"] = 0
    for booking in made:
        row = rows[booking.body["account_id"], booking.body["source_key"]]
        wanted = booking.journal.category
        if row["transfer_group"] is not None:
            c["categories on a transfer"] += bool(wanted)
        elif wanted is None:
            c["categories sorted by a rule only"] += row["category_id"] is not None
        elif row["category_id"] == categories[wanted]:
            c["categories already as in Firefly"] += 1
        else:
            api.set_category(row["id"], categories[wanted])
            c["categories set by hand"] += 1
    c["bookings in a transfer"] = sum(r["transfer_group"] is not None for r in rows.values())


def main(argv: list[str] | None = None) -> int:
    """Read the env, import or, with `--dry-run`, only count, and answer the exit code."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    # httpx logs every request at INFO, which would bury the counts.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(prog="kasten-firefly-import")
    parser.add_argument(
        "--dry-run", action="store_true", help="read Firefly and count, write nothing"
    )
    args = parser.parse_args(argv)
    ff = firefly.read(os.environ["FIREFLY_DATABASE_URL"])
    if args.dry_run:
        plan(ff)[0].print()
        return 0
    api_url = os.environ.get("KASTEN_API", "http://kasten-backend-prod:8000")
    with httpx.Client(base_url=api_url, timeout=120) as client:
        run(ff, KastenApi(client)).print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
