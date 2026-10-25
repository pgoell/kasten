/**
 * The calls the finance pane's overview, budget and transactions make: the month's budget,
 * free to spend, the trend, the bookings, a limit, the accounts and the bank pull.
 *
 * Apart from `finance-api.ts`, which holds the sorting calls the to-sort view makes. The
 * answers are the ones `routes/finance_budget.py`, `routes/finance.py` and
 * `routes/finance_sync.py` give.
 */

import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

export type Budget = components["schemas"]["BudgetOut"];
export type BudgetCategory = components["schemas"]["BudgetCategoryOut"];
export type FreeToSpend = components["schemas"]["FreeToSpendOut"];
export type Free = components["schemas"]["FreeOut"];
export type Trend = components["schemas"]["TrendOut"];
export type Transaction = components["schemas"]["TransactionOut"];
export type Account = components["schemas"]["AccountOut"];
export type SyncStatus = components["schemas"]["SyncStatus"];

/** What the transactions list narrows to; every field left out matches every booking. */
export interface TransactionFilter {
  month?: string;
  account?: number;
  category?: number;
  text?: string;
}

/** The bookings a filter answers with at once, newest first. A month holds about 100. */
const PAGE = 500;

function failed(what: string, error: { detail?: unknown } | undefined, status: number): Error {
  return new Error(reason(error) ?? `${what} failed with ${status}`);
}

export async function fetchBudget(month: string, today: string): Promise<Budget> {
  const { data, error, response } = await client.GET("/api/finance/budget", {
    params: { query: { month, today } },
  });
  if (!data) throw failed("GET /api/finance/budget", error, response.status);
  return data;
}

export async function fetchFree(month: string, today: string): Promise<FreeToSpend> {
  const { data, error, response } = await client.GET("/api/finance/budget/free", {
    params: { query: { month, today } },
  });
  if (!data) throw failed("GET /api/finance/budget/free", error, response.status);
  return data;
}

export async function fetchTrend(month: string): Promise<Trend> {
  const { data, error, response } = await client.GET("/api/finance/budget/trend", {
    params: { query: { month, months: 12 } },
  });
  if (!data) throw failed("GET /api/finance/budget/trend", error, response.status);
  return data;
}

export async function fetchTransactions(filter: TransactionFilter): Promise<Transaction[]> {
  const { data, error, response } = await client.GET("/api/finance/transactions", {
    params: { query: { ...filter, text: filter.text || undefined, order: "desc", limit: PAGE } },
  });
  if (!data) throw failed("GET /api/finance/transactions", error, response.status);
  return data;
}

export async function fetchAccounts(): Promise<Account[]> {
  const { data, error, response } = await client.GET("/api/finance/accounts");
  if (!data) throw failed("GET /api/finance/accounts", error, response.status);
  return data;
}

/** Set a category's limit from `month` on; null takes it away. */
export async function writeLimit(
  category: number,
  amount: string | null,
  month: string,
): Promise<void> {
  const { error, response } = await client.PUT("/api/finance/categories/{category_id}/limit", {
    params: { path: { category_id: category } },
    body: { amount, from: month },
  });
  if (!response.ok) throw failed("Setting the limit", error, response.status);
}

export async function fetchSync(): Promise<SyncStatus> {
  const { data, error, response } = await client.GET("/api/finance/sync");
  if (!data) throw failed("GET /api/finance/sync", error, response.status);
  return data;
}

/** "Pull now": the bank job sees the request within a minute and starts a pull. */
export async function requestPull(): Promise<void> {
  const { error, response } = await client.POST("/api/finance/sync/requests");
  if (!response.ok) throw failed("Asking for a pull", error, response.status);
}
