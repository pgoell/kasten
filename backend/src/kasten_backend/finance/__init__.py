"""Finance, its own system of record in the `finance` schema, and its entry points.

`routes` holds every router `main` mounts and `routes.records.guard.FinanceGuard`; each `models`
(`records`, `plans`, `budget`, `tax`, `feeds.sync_models`, `feeds.orders`) is a table module
`alembic/env.py` registers. `budget.drill` reads drilldowns, flow and spans; `feeds` the bank sync.
"""
