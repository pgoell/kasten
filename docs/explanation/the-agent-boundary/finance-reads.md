---
type: Explanation
title: Finance reads past the boundary
description: Why a token reads the finance pane's summaries and single bookings, why the summaries are the pane's own figures, why nothing writes, and what a leaked token now exposes.
tags: [agent, tokens, security, finance]
status: stable
---

# Finance reads past the boundary

The finance module keeps money in Postgres, outside the vault
([Finance in Postgres](/explanation/finance-in-postgres.md)). Its reads are the
first capability that reaches data no note holds, so they argue their way in
like `file` did, and on harder ground: they add nothing a token can break, and
a great deal it can expose.

What they are: the finance pane's own summaries (free to spend, the budget
table, the goals, the forecast, the sync status), a page of single bookings
with filters, one booking whole with its raw bank record, and a list of the
accounts, categories and payees. All of them read. No tool and no route under
`/agent/finance/` writes, so an agent cannot sort a booking, move money into a
goal or make a plan. Those stay in the pane, where the person doing them sees
the figures change.

The first design gave agents totals and nothing else: summary views, and a
database role with no grant on the bookings. It was dropped on 2026-10-25.
Finance is useful to an agent mostly in the detail. "Why is Groceries over?"
is a question about bookings, and so are a duplicate, a missed refund and a
payee that changed its name. A total says that something is wrong; only the
bookings say what.

The summaries are the pane's route functions called as they are, not a second
sum of the rows, so an agent's figure for a month is the one the pane shows.
That matters more than it seems. The budget has rules a sum of rows gets
wrong: a salary past the cutoff day counts for the next month, the transfer
into the shared account is a cost on one side and income on the other, a move
between own accounts is no spending, a split carries its own category. An
agent that summed `list_transactions` would get each of them wrong in its own
way, so each tool's description tells it to read the summary for a total.

The cost is stated plainly, and it was accepted on purpose: **a leaked token
exposes every transaction.** Every booking since the Firefly import, with the
counterparty's name and IBAN, the purpose line and the raw record the bank
sent, is one paged read away from whoever holds it. The same holds for a model
fooled by text it read. The chat pane's model runs every tool without asking
and reaches `/api/finance/` from inside the box, so a note that tells it to
fetch the bookings and write them somewhere is a note to be careful with.
Nothing undoes a read. What bounds the damage is what bounds a leaked token
anywhere here: one revoke at `/tokens`, taking effect on the next request.

Tokens are not scoped, so the reads reach every token there is, the ones
minted or connected before this release included. None of them was asked
again: a token granted for the notes now reads finance too, from the first
request after the upgrade. A token that should not see money is revoked at
`/tokens`, and a product that still needs the notes connects again, through
the consent screen that now names the finance reads.

A backend with no database, the self-host default, has no finance. Its finance
routes answer `503` and its finance tools fail with the same sentence, so a
token there exposes no more than the vault.

## Related

* [The agent boundary](/explanation/the-agent-boundary.md): the ten capabilities on the vault, and the gate in front of them all
* [Agent routes](/reference/agent-api/routes.md#the-finance-reads): the finance routes and the tools beside them
* [Finance in Postgres](/explanation/finance-in-postgres.md): why money lives outside the vault
