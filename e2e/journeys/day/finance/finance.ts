import type { Page, Request } from "@playwright/test";
import { openApp } from "../../../harness/app.ts";
import { expect } from "../../../harness/stack.ts";

/** What a finance route answers: a JSON body, or an async function of the request giving a status and body. */
export type Answer = unknown;
type Reply = (request: Request) => Promise<{ status?: number; json?: unknown }>;

/** An answer that never comes, for a read the journey does not look at. */
export const never = (): Promise<never> => new Promise(() => undefined);

/**
 * Opens the finance pane on 25 October 2026 over `answers`, keyed `METHOD path`. Each request
 * to /api/finance is kept as `METHOD path?query body`; a write no answer names gets a 204, and a
 * read none names goes to the real backend.
 */
export async function openFinance(page: Page, answers: Record<string, Answer>) {
  const sent: string[] = [];
  await page.route("**/api/finance/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData();
    sent.push(`${request.method()} ${url.pathname}${url.search}${body === null ? "" : ` ${body}`}`);
    const answer = answers[`${request.method()} ${url.pathname}`];
    if (answer === undefined) {
      return request.method() === "GET" ? route.fallback() : route.fulfill({ status: 204 });
    }
    if (typeof answer !== "function") return route.fulfill({ json: answer });
    const { status, json } = await (answer as Reply)(request);
    return route.fulfill(json === undefined ? { status: status ?? 204 } : { status, json });
  });
  await page.clock.setFixedTime(new Date("2026-10-25T12:00:00"));
  await openApp(page);
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /^Open the finance pane/ }).click();
  const finance = page.getByRole("region", { name: "Finance" });
  await expect(finance).toBeVisible();
  await finance.focus();
  /** The requests sent so far whose line starts with `start`. */
  const sentTo = (start: string) => sent.filter((line) => line.startsWith(start));
  return { finance, sent, sentTo };
}

export const CATEGORIES = [
  { id: 4, name: "Groceries", kind: "flexible" },
  { id: 6, name: "Dining", kind: "flexible" },
];

export const BOOKING = {
  id: 9,
  account_id: 1,
  booking_date: "2026-10-05",
  value_date: null,
  amount: "-100.00",
  currency: "EUR",
  purpose: "REWE SAGT DANKE",
  posting_text: "Kartenzahlung",
  counterparty_name: "REWE",
  counterparty_iban: null,
  bank_ref: null,
  raw: { amount: "-100,00" },
  source_key: "k9",
  imported_at: "2026-10-05T10:00:00Z",
  transfer_group: null,
  payee_id: 5,
  category_id: 4,
  category_set_by: "rule",
  splits: [],
};

/** BOOKING split 70 to Groceries and 30 to `wine`, which Dining takes or nothing does. */
export const split = (wine: number | null) => ({
  ...BOOKING,
  category_id: null,
  splits: [
    { id: 1, amount: "-70.00", text: "food", category_id: 4, category_set_by: "hand" },
    { id: 2, amount: "-30.00", text: "wine", category_id: wine, category_set_by: wine && "hand" },
  ],
});

const month = (at: string, figures: Record<string, string> = {}) => ({
  month: at,
  ...{ income: "0.00", other_scope: "0.00", fixed: "0.00", flexible: "0.00", non_monthly: "0.00" },
  ...{ reserved: "0.00", saved: "0.00", unsorted: "0.00", left: "0.00" },
  ...figures,
});
const OCTOBER = month("2026-10", {
  ...{ income: "3000.00", other_scope: "900.00", flexible: "100.00" },
  ...{ saved: "300.00", left: "1700.00" },
});

export const SCOPE = {
  scope: "mine",
  month: "2026-10",
  months: [month("2026-09"), OCTOBER],
  accounts: [
    {
      ...{ id: 1, name: "Giro", kind: "giro", balance: "1680.00" },
      ...{ balance_on: "2026-10-02", moved: "-1320.00" },
    },
  ],
  bookings: [BOOKING],
  first: "2026-10",
  span: {
    now: OCTOBER,
    last_year: month("2025-10", { income: "2800.00", left: "2800.00" }),
    average: null,
  },
};

const counted = (total: string) => ({
  mine: total,
  household: "0.00",
  total,
  from_reserve: "0.00",
});

export const CATEGORY = {
  category: CATEGORIES[0],
  month: "2026-10",
  months: [
    {
      ...{ month: "2026-10", mine: "100.00", household: "0.00", total: "100.00" },
      ...{ from_reserve: "0.00", limit: "400.00", available: "400.00", average: "380.00" },
    },
  ],
  first: "2026-10",
  span: {
    now: counted("100.00"),
    last_year: counted("80.00"),
    average: counted("380.00"),
    available: "400.00",
  },
  payees: [{ id: 5, name: "REWE", amount: "100.00" }],
  plans: [],
  rules: [{ id: 3, kind: "payee", pattern: "rewe", category_id: 4 }],
  bookings: [BOOKING],
};

export const PAYEE = {
  payee: { id: 5, key: "rewe markt", name: "REWE", category_id: null },
  month: "2026-10",
  months: [{ month: "2026-10", spent: "100.00", received: "0.00", saved: "0.00", bookings: 2 }],
  average: "90.00",
  average_received: "0.00",
  categories: [{ id: 4, name: "Groceries", kind: "flexible", amount: "100.00" }],
  rules: [],
  bookings: [BOOKING],
};

export const DRILLED = {
  transaction: BOOKING,
  account: { id: 1, name: "Giro", bank: "DKB", iban: null, kind: "giro", shared: false },
  payee: PAYEE.payee,
  twin: null,
  plans: [],
  counts: [{ month: "2026-10", scope: "mine", part: "flexible", category_id: 4, amount: "100.00" }],
};

/** The drilldowns' reads, as the jsdom tests answered them, with `over` on top. */
export const drills = (over: Record<string, Answer> = {}): Record<string, Answer> => ({
  "GET /api/finance/categories": CATEGORIES,
  "GET /api/finance/transactions": [BOOKING],
  "GET /api/finance/drill/scopes/mine": SCOPE,
  "GET /api/finance/drill/accounts/1": never,
  "GET /api/finance/drill/categories/4": CATEGORY,
  "GET /api/finance/drill/payees/5": PAYEE,
  "GET /api/finance/drill/bookings/9": DRILLED,
  ...over,
});

/** Opens the Transactions tab by its key, then the booking under the cursor by Enter. */
export async function openBooking(page: Page) {
  await page.keyboard.press("T");
  await expect(page.getByText("REWE SAGT DANKE")).toBeVisible();
  await page.keyboard.press("Enter");
}

/** The breadcrumbs, each crumb one item. */
export const crumbs = (page: Page) =>
  page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("listitem");
