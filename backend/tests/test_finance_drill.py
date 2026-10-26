"""The drilldown routes, through the routes on a migrated database, skipped without one.

The figures are tested without a database in test_finance_drill_model.py;
these check the routes read the same bookings the overview and the sankey
read, and list the bookings of the budget month, the salary cutoff included.
"""

from typing import TYPE_CHECKING, Any

from backend.tests.finance_rows import API, SAVING, booking, category, post, rule
from backend.tests.test_finance_budget import household

if TYPE_CHECKING:
    from httpx import AsyncClient

OCTOBER = {"month": "2026-10", "months": 2}


async def settled(client: AsyncClient) -> dict[str, int]:
    """The household of test_finance_budget.py with Salary marked as salary, cut off on the 15th."""
    ids = await household(client)
    await client.put(
        f"{API}/budget/settings",
        json={"salary_cutoff_day": 15, "salary_category_ids": [ids["salary"]]},
    )
    return ids


async def by_key(client: AsyncClient) -> dict[str, dict[str, Any]]:
    rows = (await client.get(f"{API}/transactions")).json()
    return {row["source_key"]: row for row in rows}


async def test_a_scope_drill_is_the_sankeys_month_and_lists_the_salary_it_counts(
    finance_client: AsyncClient,
) -> None:
    await settled(finance_client)
    mine = (await finance_client.get(f"{API}/drill/scopes/mine", params=OCTOBER)).json()
    flow = (await finance_client.get(f"{API}/budget/flow", params={"month": "2026-10"})).json()
    names = {node["key"]: node["name"] for node in flow["nodes"]}
    streams = {(names[x["source"]], names[x["target"]]): x["amount"] for x in flow["links"]}

    september, october = mine["months"]
    assert september["income"] == "0.00"
    assert october["income"] == streams["Salary", "Mine"] == "3000.00"
    assert october["other_scope"] == streams["Mine", "Into household"] == "900.00"
    assert october["saved"] == streams["Mine", "Saved"] == "300.00"
    assert october["flexible"] == "120.00"
    assert october["left"] == streams["Mine", "Left over"] == "1680.00"
    # The salary booked on 20 September is October's, and the saving account is in no scope.
    keys = {row["source_key"] for row in mine["bookings"]}
    assert keys == {"pay", "out", "save", "food"}
    assert [a["name"] for a in mine["accounts"]] == ["Giro"]

    shared = (await finance_client.get(f"{API}/drill/scopes/household", params=OCTOBER)).json()
    assert shared["months"][-1]["other_scope"] == "900.00"
    assert {row["source_key"] for row in shared["bookings"]} == {"in", "alicia", "rent"}


async def test_a_category_drill_counts_a_split_part_and_its_payees_add_up(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    await post(
        finance_client,
        [
            booking(
                ids["giro"], "rewe", "-100.00", booking_date="2026-10-05", counterparty_name="REWE"
            ),
        ],
    )
    rewe = (await by_key(finance_client))["rewe"]
    split = await finance_client.put(
        f"{API}/transactions/{rewe['id']}/splits",
        json=[{"amount": "-70.00", "text": "food"}, {"amount": "-30.00", "text": "rent share"}],
    )
    parts = split.json()["splits"]
    for part, name in zip(parts, ("groceries", "rent"), strict=True):
        await finance_client.put(
            f"{API}/splits/{part['id']}/category", json={"category_id": ids[name]}
        )

    found = (
        await finance_client.get(f"{API}/drill/categories/{ids['groceries']}", params=OCTOBER)
    ).json()
    budget = (
        await finance_client.get(
            f"{API}/budget", params={"month": "2026-10", "today": "2026-10-10"}
        )
    ).json()
    groceries = next(row for row in budget["categories"] if row["id"] == ids["groceries"])

    assert found["months"][-1]["total"] == groceries["spent"] == "190.00"
    assert {p["name"]: p["amount"] for p in found["payees"]} == {
        "REWE": "70.00",
        "No payee": "120.00",
    }
    assert {row["source_key"] for row in found["bookings"]} == {"rewe", "food"}

    payee = rewe["payee_id"]
    # An ignored booking of the same payee counts in neither its spending nor its bookings.
    work = await category(finance_client, "Work travel", "ignore")
    await post(
        finance_client,
        [
            booking(
                ids["giro"], "hotel", "-80.00", booking_date="2026-10-06", counterparty_name="REWE"
            )
        ],
    )
    hotel = (await by_key(finance_client))["hotel"]
    await finance_client.put(
        f"{API}/transactions/{hotel['id']}/category", json={"category_id": work}
    )
    view = (await finance_client.get(f"{API}/drill/payees/{payee}", params=OCTOBER)).json()
    assert view["months"][-1]["spent"] == "100.00"
    assert view["months"][-1]["bookings"] == 1
    assert {c["name"]: c["amount"] for c in view["categories"]} == {
        "Groceries": "70.00",
        "Rent": "30.00",
    }


async def test_an_account_drill_walks_its_balance_and_keeps_transfers_apart(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    await finance_client.post(
        f"{API}/balances",
        json=[{"account_id": ids["giro"], "date": "2026-10-02", "amount": "1680.00"}],
    )
    found = (await finance_client.get(f"{API}/drill/accounts/{ids['giro']}", params=OCTOBER)).json()

    september, october = found["months"]
    # 1680 on 2 October holds the day's bookings; September ends before them.
    assert october["balance"] == "1680.00"
    assert september["balance"] == "3000.00"
    assert october["money_out"] == "1320.00"
    assert found["scope"] == "mine"
    assert {t["name"]: t["amount"] for t in found["transfers"]} == {
        "Shared": "-900.00",
        "Saving": "-300.00",
    }
    # By booking date: the salary of 20 September is September's here.
    assert {c["name"]: c["amount"] for c in found["categories"]} == {"Groceries": "-120.00"}
    assert {row["source_key"] for row in found["bookings"]} == {"out", "save", "food"}


async def test_a_booking_drill_says_where_it_counts_and_finds_its_twin(
    finance_client: AsyncClient,
) -> None:
    await settled(finance_client)
    rows = await by_key(finance_client)

    out = (await finance_client.get(f"{API}/drill/bookings/{rows['out']['id']}")).json()
    assert out["twin"]["source_key"] == "in"
    assert [(c["scope"], c["part"], c["amount"]) for c in out["counts"]] == [
        ("mine", "other_scope", "900.00")
    ]
    pay = (await finance_client.get(f"{API}/drill/bookings/{rows['pay']['id']}")).json()
    assert [(c["month"], c["part"]) for c in pay["counts"]] == [("2026-10", "income")]
    assert pay["transaction"]["purpose"] == "Lohn"
    assert pay["account"]["name"] == "Giro"


async def test_a_drill_into_nothing_is_a_404(finance_client: AsyncClient) -> None:
    for path in ("categories/0", "payees/0", "accounts/0"):
        response = await finance_client.get(f"{API}/drill/{path}", params=OCTOBER)
        assert response.status_code == 404, path
    assert (await finance_client.get(f"{API}/drill/bookings/0")).status_code == 404
    assert (
        await finance_client.get(f"{API}/drill/scopes/theirs", params=OCTOBER)
    ).status_code == 422


async def sort(client: AsyncClient, key: str, category_id: int) -> dict[str, Any]:
    """Set a stored booking's category by hand and hand back the booking."""
    row = (await by_key(client))[key]
    await client.put(f"{API}/transactions/{row['id']}/category", json={"category_id": category_id})
    return row


async def test_an_accounts_money_in_and_out_are_summed_apart_within_a_day(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    # A refund on the day of 1320 out must not net it down to 1270.
    await post(
        finance_client,
        [booking(ids["giro"], "refund", "50.00", booking_date="2026-10-02", purpose="Rewe")],
    )
    found = (await finance_client.get(f"{API}/drill/accounts/{ids['giro']}", params=OCTOBER)).json()
    october = found["months"][-1]
    assert (october["money_in"], october["money_out"]) == ("50.00", "1320.00")


async def test_a_booking_on_an_own_saving_account_is_in_no_category_or_payee_drill(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    fees = await category(finance_client, "Fees", "fixed")
    accounts = {a["name"]: a["id"] for a in (await finance_client.get(f"{API}/accounts")).json()}
    await post(
        finance_client,
        [
            booking(
                accounts["Saving"],
                "fee",
                "-5.00",
                booking_date="2026-10-03",
                counterparty_name="Bank",
            )
        ],
    )
    row = await sort(finance_client, "fee", fees)
    drilled = (await finance_client.get(f"{API}/drill/categories/{fees}", params=OCTOBER)).json()
    assert drilled["months"][-1]["total"] == "0.00"
    assert drilled["bookings"] == []
    payee = (
        await finance_client.get(f"{API}/drill/payees/{row['payee_id']}", params=OCTOBER)
    ).json()
    assert payee["months"][-1] == {
        "month": "2026-10",
        "spent": "0.00",
        "received": "0.00",
        "saved": "0.00",
        "bookings": 0,
    }
    assert payee["bookings"] == []
    assert ids


async def test_half_a_transfer_whose_twin_is_not_in_is_in_no_category_drill(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    await post(
        finance_client,
        [
            booking(
                ids["giro"], "half", "-200.00", booking_date="2026-10-04", counterparty_iban=SAVING
            )
        ],
    )
    await sort(finance_client, "half", ids["groceries"])
    drilled = (
        await finance_client.get(f"{API}/drill/categories/{ids['groceries']}", params=OCTOBER)
    ).json()
    assert drilled["months"][-1]["total"] == "120.00"
    assert {row["source_key"] for row in drilled["bookings"]} == {"food"}


async def test_a_split_across_the_cutoff_lists_by_the_category_asked_for(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    fees = await category(finance_client, "Fees", "fixed")
    await post(
        finance_client,
        [booking(ids["giro"], "mixed", "3000.00", booking_date="2026-10-20", purpose="Lohn")],
    )
    row = (await by_key(finance_client))["mixed"]
    split = await finance_client.put(
        f"{API}/transactions/{row['id']}/splits",
        json=[{"amount": "3100.00", "text": "pay"}, {"amount": "-100.00", "text": "fee"}],
    )
    pay, fee = split.json()["splits"]
    await finance_client.put(
        f"{API}/splits/{pay['id']}/category", json={"category_id": ids["salary"]}
    )
    await finance_client.put(f"{API}/splits/{fee['id']}/category", json={"category_id": fees})

    def listed(found: dict[str, Any]) -> set[str]:
        return {b["source_key"] for b in found["bookings"]}

    async def drill(category_id: int, month: str) -> dict[str, Any]:
        query = {"month": month, "months": 1}
        return (
            await finance_client.get(f"{API}/drill/categories/{category_id}", params=query)
        ).json()

    # The salary part counts for November, the fee part in October.
    assert "mixed" not in listed(await drill(ids["salary"], "2026-10"))
    assert "mixed" in listed(await drill(ids["salary"], "2026-11"))
    assert "mixed" in listed(await drill(fees, "2026-10"))
    november_fees = await drill(fees, "2026-11")
    assert november_fees["months"][-1]["total"] == "0.00"
    assert "mixed" not in listed(november_fees)


async def test_a_payee_that_pays_in_averages_its_money_in_and_lists_only_its_sides_rules(
    finance_client: AsyncClient,
) -> None:
    ids = await settled(finance_client)
    await post(
        finance_client,
        [
            booking(
                ids["giro"],
                f"boss{m}",
                "1000.00",
                booking_date=f"2026-{m}-05",
                counterparty_name="Boss",
            )
            for m in ("08", "09")
        ],
    )
    for m in ("08", "09"):
        row = await sort(finance_client, f"boss{m}", ids["contribution"])
    await rule(finance_client, "payee", "boss", ids["contribution"])
    await rule(finance_client, "payee", "boss", ids["groceries"])
    found = (
        await finance_client.get(f"{API}/drill/payees/{row['payee_id']}", params=OCTOBER)
    ).json()
    assert found["average"] == "0.00"
    assert found["average_received"] == "1000.00"
    # Boss only pays in, so the rule that sorts money out into Groceries does not name it.
    assert [r["category_id"] for r in found["rules"]] == [ids["contribution"]]
