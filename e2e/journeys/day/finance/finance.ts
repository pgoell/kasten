import type { Page, Request } from "@playwright/test";
import { openApp } from "../../../harness/app.ts";
import { expect } from "../../../harness/stack.ts";

/** What a finance route answers: a JSON body, or an async function of the request giving a status and body. */
export type Answer = unknown;
type Reply = (request: Request) => Promise<{ status?: number; json?: unknown }>;

/** CDP's modifier bits. AltGr reads as Ctrl+Alt on Windows; Option is Alt on a Mac. */
export const ALT = 1;
export const CTRL = 2;

/** Types `key` the way a German layout does: AltGr+8 or Option+5 for `[`, AltGr+9 or Option+6 for `]`. */
export async function typeHeld(page: Page, key: "[" | "]", modifiers: number) {
  const code =
    modifiers & CTRL ? (key === "[" ? "Digit8" : "Digit9") : key === "[" ? "Digit5" : "Digit6";
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await cdp.detach();
}

/** Whether the page is a phone's narrow screen, as `phone` in the harness makes it. */
export const onPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 600;

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
  if (onPhone(page)) {
    // A phone has no file tree to wait on: the thumb row's command button opens the palette.
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await commands.getByRole("button", { name: "Run a command by name" }).tap({ timeout: 15_000 });
    await page.getByRole("combobox").fill("finance");
    await page.getByRole("option", { name: /^Open the finance pane/ }).tap();
  } else {
    await openApp(page);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the finance pane/ }).click();
  }
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

export const PROPOSAL = {
  ...{ key: "bill:Haftpflicht", source: "bill", name: "Haftpflicht", account_id: 1, payee_id: 9 },
  ...{ text: null, amount: "-498.00", tolerance: "12.00", every_months: 12, category_id: 3 },
  ...{ start: "2026-03-02", seen: 1, last: "2026-03-02" },
};

/** PROPOSAL as the plan it proposes, the body a confirm sends. */
export const { key: _k, source: _s, seen: _n, last: _l, ...PLAN } = PROPOSAL;

export const WEDDING = {
  ...{ id: 7, name: "Wedding", target: "12000.00", due: "2027-08-01", account_id: 5 },
  ...{ reserved: "4500.00", monthly: "500.00", progress: "0.3750", need: "750.00" },
  this_month: { planned: "500.00", moved: "500.00", done: true },
  assigned_month: null,
  assigned_amount: null,
};

export const ACCOUNT = {
  ...{ id: 5, name: "DKB Personal Saving", balance: "21300.00", balance_date: "2026-10-24" },
  ...{ reserved: "4500.00", unreserved: "16800.00" },
};

const MIETE = {
  ...{ plan_id: 1, name: "Miete", due: "2026-10-01", amount: "-950.00", category_id: 2 },
  reserves: false,
  match: { transaction_id: 4, booking_date: "2026-09-30", amount: "-950.00", timing: "early" },
  counts_for: null,
};

/** The Plans & goals tab's reads, as the jsdom tests answered them, with `over` on top. */
export const plans = (over: Record<string, Answer> = {}): Record<string, Answer> => ({
  "GET /api/finance/categories": [],
  "GET /api/finance/to-sort": { total: 0, bookings: [] },
  "GET /api/finance/plans": [],
  "GET /api/finance/plans/upcoming": [MIETE],
  "GET /api/finance/plans/forecast": {
    mine: { balance: "0.00", months: [] },
    household: { balance: "0.00", months: [] },
  },
  "GET /api/finance/plans/proposals": [PROPOSAL],
  "GET /api/finance/goals": { goals: [WEDDING], accounts: [ACCOUNT] },
  "POST /api/finance/contracts/reminders": [],
  "GET /api/finance/contracts": { contracts: [], yearly: "0.00" },
  "GET /api/finance/budget": {
    ...{ month: "2026-10", share_of_month: "0.8", categories: [] },
    unreserved: { last_month: "40.00", total: "120.00", moved: "0.00" },
  },
  ...over,
});

/** Opens the Plans & goals tab over `plans(over)`, by its key or, on a phone, its tab. */
export async function openPlans(page: Page, over: Record<string, Answer> = {}) {
  const opened = await openFinance(page, plans(over));
  if (onPhone(page)) await opened.finance.getByRole("tab", { name: /^Plans/ }).tap();
  else await page.keyboard.press("G");
  return opened;
}
