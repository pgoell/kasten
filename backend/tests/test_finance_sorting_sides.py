"""Which side of a booking a rule sorts: money in, money out, or both for an ignore category.

Every test goes through the routes, on a migrated database, and skips
without one; see the `finance_session` fixture.
"""

from typing import TYPE_CHECKING

from backend.tests.finance_rows import API, account, booking, category, post, rule, stored

if TYPE_CHECKING:
    from httpx import AsyncClient


async def test_a_rule_sorts_only_its_categorys_side(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro")
    salary = await category(finance_client, "Salary", kind="income")
    shop = await category(finance_client, "Shopping")
    await rule(finance_client, "payee", "deloitte", salary)
    await rule(finance_client, "text_contains", "amazon", shop)
    await post(
        finance_client,
        [
            booking(
                giro, "pay", amount="3000.00", purpose="LOHN", counterparty_name="Deloitte GmbH"
            ),
            booking(giro, "lunch", purpose="", counterparty_name="Deloitte GmbH"),
            booking(giro, "order", purpose="AMAZON 302"),
            booking(giro, "refund", amount="12.00", purpose="AMAZON 302 refund"),
        ],
    )

    rows = await stored(finance_client)
    assert rows["pay"]["category_id"] == salary
    assert rows["lunch"]["category_id"] is None
    assert rows["order"]["category_id"] == shop
    assert rows["refund"]["category_id"] is None

    flipped = await finance_client.put(
        f"{API}/categories/{shop}", json={"name": "Shopping", "kind": "income"}
    )

    assert flipped.status_code == 200
    rows = await stored(finance_client)
    assert rows["order"]["category_id"] is None
    assert rows["refund"]["category_id"] == shop


async def test_one_pattern_may_sort_each_side_and_a_split_takes_its_own_side(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    refund = await category(finance_client, "Refunds", kind="income")
    shop = await category(finance_client, "Shopping")
    await rule(finance_client, "text_contains", "cable", shop)
    await rule(finance_client, "text_contains", "cable", refund)
    repeat = await finance_client.post(
        f"{API}/rules", json={"kind": "text_contains", "pattern": "Cable", "category_id": shop}
    )
    await post(finance_client, [booking(giro, "order", amount="-20.00", purpose="Order")])
    order = (await stored(finance_client))["order"]["id"]

    split = await finance_client.put(
        f"{API}/transactions/{order}/splits",
        json=[{"amount": "-30.00", "text": "Cable"}, {"amount": "10.00", "text": "Cable return"}],
    )

    assert repeat.status_code == 409
    assert [(s["amount"], s["category_id"]) for s in split.json()["splits"]] == [
        ("-30.00", shop),
        ("10.00", refund),
    ]


async def test_an_ignore_rule_sorts_both_sides_so_a_cost_and_its_reimbursement_cancel(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    reimbursed = await category(finance_client, "Reimbursement", kind="ignore")
    await rule(finance_client, "text_contains", "hotel adlon", reimbursed)
    await post(
        finance_client,
        [
            booking(giro, "stay", amount="-180.00", purpose="Hotel Adlon Berlin"),
            booking(giro, "back", amount="180.00", purpose="Reisekosten Hotel Adlon"),
        ],
    )

    rows = await stored(finance_client)
    assert rows["stay"]["category_id"] == reimbursed
    assert rows["back"]["category_id"] == reimbursed

    rules = (await finance_client.get(f"{API}/rules")).json()
    flipped = await finance_client.put(
        f"{API}/categories/{reimbursed}", json={"name": "Reimbursement", "kind": "flexible"}
    )
    assert flipped.status_code == 200
    rows = await stored(finance_client)
    assert len(rules) == 1
    assert rows["stay"]["category_id"] == reimbursed
    assert rows["back"]["category_id"] is None
