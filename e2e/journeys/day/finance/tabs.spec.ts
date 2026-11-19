import type { Locator, Page } from "@playwright/test";
import { leader, phone } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import {
  ALT,
  type Answer,
  BOOKING,
  CATEGORIES,
  CTRL,
  crumbs,
  never,
  onPhone,
  openFinance,
  typeHeld,
} from "./finance.ts";

/**
 * Runs the pane alone, as React may, keeping the tab as drawn (#2232): a pane state set anew,
 * then set again to the very same value, which React renders and then bails out of below.
 */
async function samePaneRender(finance: Locator) {
  await finance.evaluate(async (section) => {
    type Hook = { memoizedState: unknown; queue?: { dispatch?: (v: unknown) => void }; next: Hook };
    const key = Object.keys(section).find((name) => name.startsWith("__reactFiber$")) ?? "";
    // The section is what the pane draws, so the fiber above it is the pane's.
    const pane = (section as unknown as Record<string, { return: { memoizedState: Hook } }>)[key];
    let hook: Hook | null = pane.return.memoizedState;
    while (hook && !(Array.isArray(hook.memoizedState) && hook.queue?.dispatch)) hook = hook.next;
    const set = hook?.queue?.dispatch;
    if (!set) throw new Error("the pane holds no list state to set");
    const settle = () => new Promise((done) => setTimeout(done, 50));
    const fresh: unknown[] = [];
    set(fresh);
    await settle();
    set(fresh);
    await settle();
  });
}

const part = (total: string) => ({ total, lines: [] });
const MINE = {
  total: "736.00",
  income: {
    total: "3450.00",
    lines: [
      {
        ...{ name: "Salary", category_id: 1, so_far: "0.00", average: "3450.00" },
        ...{ counted: "3450.00", basis: "average" },
      },
    ],
  },
  ...{ fixed: part("1247.00"), flexible: part("591.00"), non_monthly: part("0.00") },
  ...{ unsorted: "0.00", saved: "450.00", reserves: part("0.00"), goals: part("0.00") },
};
const GROCERIES = {
  ...{ id: 4, name: "Groceries", kind: "flexible", limit: "500.00", carried: "40.00" },
  ...{ available: "460.00", spent: "470.00", average: "540.00", expected_by_now: "370.00" },
  ...{ status: "over", suggestion: { direction: "raise", amount: "540.00" } },
};
const RENT = {
  ...{ ...GROCERIES, id: 5, name: "Rent", kind: "fixed", limit: "1650.00", carried: "0.00" },
  ...{ available: "1650.00", spent: "1650.00", average: "1650.00", expected_by_now: null },
  ...{ status: "ok", suggestion: null },
};
const node = (key: string, name: string, role: string, column: number, amount: string) => ({
  ...{ key, name, role, column, amount },
  category_id: role === "category" ? 4 : null,
});
const FLOW = {
  ...{ month: "2026-10", total: "3000.00" },
  nodes: [
    node("income-1", "Salary", "source", 0, "3000.00"),
    node("mine", "Mine", "scope", 1, "3000.00"),
    node("kind-mine-flexible", "Flexible", "kind", 2, "400.00"),
    node("left-over-mine", "Left over", "left_over", 2, "2600.00"),
    node("category-4", "Groceries", "category", 3, "400.00"),
  ],
  links: [
    { source: "income-1", target: "mine", amount: "3000.00" },
    { source: "mine", target: "kind-mine-flexible", amount: "400.00" },
    { source: "mine", target: "left-over-mine", amount: "2600.00" },
    { source: "kind-mine-flexible", target: "category-4", amount: "400.00" },
  ],
};
const SYNC = {
  ...{ requested_at: null, last_run: null, running: false, accounts: [] },
  ...{ last_success_at: "2026-10-24T15:00:00Z", days_since_success: 1 },
};
const TEGUT = { ...BOOKING, id: 10, counterparty_name: "Tegut", purpose: "Tegut", payee_id: null };

/** Opens the finance pane over the reads the jsdom tests answered, with `over` on top. */
const open = (page: Page, over: Record<string, Answer> = {}) =>
  openFinance(page, {
    "GET /api/finance/categories": CATEGORIES,
    "GET /api/finance/to-sort": { total: 0, bookings: [] },
    "GET /api/finance/budget/free": {
      month: "2026-10",
      mine: MINE,
      household: { ...MINE, total: "-20.00" },
    },
    "GET /api/finance/budget": {
      ...{ month: "2026-10", share_of_month: "0.8065", categories: [GROCERIES, RENT] },
      unreserved: { last_month: "120.00", total: "560.00" },
    },
    "GET /api/finance/budget/trend": {
      ...{ months: ["2026-09", "2026-10"], categories: [] },
      ...{ totals: ["2400.00", "2100.00"], limits: [null, "2150.00"] },
    },
    "GET /api/finance/budget/flow": FLOW,
    "GET /api/finance/budget/range": never,
    "GET /api/finance/transactions": [BOOKING],
    "GET /api/finance/accounts": [],
    "GET /api/finance/sync": SYNC,
    "GET /api/finance/goals": { goals: [], accounts: [] },
    "GET /api/finance/drill/categories/4": never,
    ...over,
  });

const month = (finance: Locator, name: string) => finance.getByRole("heading", { name });
const limit = (finance: Locator) =>
  finance.getByRole("textbox", { name: "Rent limit from October 2026" });

/** Opens the Budget tab by its key, once its suggestion is drawn. */
async function budget(page: Page, finance: Locator) {
  await page.keyboard.press("B");
  await expect(finance.getByText(/Raise to 540/)).toBeVisible();
}

test("#1036 opens on the overview: both numbers, what they are made of, and what to watch", async ({
  page,
}) => {
  const { finance, sentTo } = await open(page);
  const mine = finance
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Mine ›" }) });

  await expect(mine.getByText(/^736\s€$/)).toBeVisible();
  await expect(finance.getByText(/^over by 20\s€ ⚠$/)).toBeVisible();
  await expect(finance.getByText(/^Over by 10\s€ ⚠$/)).toBeVisible();
  await expect(finance.getByText(/^limit cut by 40\s€ after Sept$/)).toBeVisible();
  expect(sentTo("GET /api/finance/budget/free?")[0]).toMatch(
    /month=2026-10.*today=2026-10-25|today=2026-10-25.*month=2026-10/,
  );
});

test("#1036 [ and ] step the month, and P asks for a pull", async ({ page }) => {
  const { finance, sentTo } = await open(page);
  await expect(month(finance, "October 2026")).toBeVisible();

  await page.keyboard.press("[");
  await expect(month(finance, "September 2026")).toBeVisible();
  await expect.poll(() => sentTo("GET /api/finance/budget?").join()).toContain("2026-09");
  await page.keyboard.press("]");
  await expect(month(finance, "October 2026")).toBeVisible();
  await page.keyboard.press("P");
  await expect.poll(() => sentTo("POST /api/finance/sync/requests")).toHaveLength(1);
});

// AltGr and Option typing [ and ] is the AltGr journey in finance.spec.ts; here the real chords.
test("#2070 a real chord steps no month, pulls nothing and closes nothing", async ({ page }) => {
  const { finance, sentTo } = await open(page);
  await expect(month(finance, "October 2026")).toBeVisible();

  for (const held of ["Control", "Meta", "Meta+Alt"])
    await page.keyboard.press(`${held}+BracketLeft`);
  await page.keyboard.press("Alt+Shift+P");
  await page.keyboard.press("Alt+q");
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.press("Escape");
  await finance.focus();
  // A plain [ after them steps, so each chord before it had its turn.
  await page.keyboard.press("[");

  await expect(month(finance, "September 2026")).toBeVisible();
  expect(sentTo("POST")).toEqual([]);
});

test("#1036 on the budget, y takes the suggestion and e edits the limit from the month shown", async ({
  page,
}) => {
  const { finance, sentTo } = await open(page);
  await budget(page, finance);

  // Fixed comes first, so Rent is the first row and Groceries the next.
  await page.keyboard.press("j");
  const reads = sentTo("GET /api/finance/budget?").length;
  await page.keyboard.press("y");
  await expect.poll(() => sentTo("PUT")).toHaveLength(1);
  // The save closes any limit field once its write lands, then reads the budget again (#2237).
  await expect.poll(() => sentTo("GET /api/finance/budget?").length).toBeGreaterThan(reads);
  await page.keyboard.press("k");
  await page.keyboard.press("e");
  await limit(finance).fill("1700");
  await limit(finance).press("Enter");

  await expect.poll(() => sentTo("PUT")).toHaveLength(2);
  const [taken, typed] = sentTo("PUT");
  expect(taken).toMatch(/^PUT \/api\/finance\/categories\/4\/limit .*"540\.00"/);
  expect(typed).toMatch(/^PUT \/api\/finance\/categories\/5\/limit .*"1700"/);
  expect(`${taken} ${typed}`.match(/2026-10/g)).toHaveLength(2);
});

test("#2070 [ typed through AltGr into a limit stays the field's, and a leader sequence still runs", async ({
  page,
}) => {
  const { finance } = await open(page);
  await budget(page, finance);
  await page.keyboard.press("e");
  await expect(limit(finance)).toBeFocused();

  await typeHeld(page, "[", CTRL | ALT);
  await expect(limit(finance)).toBeFocused();
  await expect(month(finance, "October 2026")).toBeVisible();
  await page.keyboard.press("Escape");
  await leader(page, "gt");

  await expect(page.getByLabel("filter todos")).toBeVisible();
});

test("#1036 on the transactions, a category key sorts the cursor's booking in place", async ({
  page,
}) => {
  const { finance, sentTo } = await open(page);
  await page.keyboard.press("T");
  await expect(finance.getByText("REWE SAGT DANKE")).toBeVisible();

  await page.keyboard.press("1");

  await expect
    .poll(() => sentTo("PUT"))
    .toEqual(['PUT /api/finance/transactions/9/category {"category_id":4}']);
  expect(sentTo("GET /api/finance/transactions?").join()).toContain("month=2026-10");
});

test("#2232 the to-sort keys still move and sort after React runs the pane and keeps its tab", async ({
  page,
}) => {
  const { finance, sentTo } = await open(page, {
    "GET /api/finance/to-sort": { total: 2, bookings: [BOOKING, TEGUT] },
  });
  await page.keyboard.press("S");
  await expect(finance.getByText("Tegut").first()).toBeVisible();
  await expect(finance.getByRole("button", { name: "1 Groceries" })).toBeVisible();

  await samePaneRender(finance);
  await page.keyboard.press("j");
  await page.keyboard.press("1");

  await expect
    .poll(() => sentTo("PUT"))
    .toEqual(['PUT /api/finance/transactions/10/category {"category_id":4}']);
});

test("#2232 the overview, which has no keys of its own, takes none of the tab before it", async ({
  page,
}) => {
  const { finance, sentTo } = await open(page, {
    "GET /api/finance/to-sort": { total: 1, bookings: [BOOKING] },
  });
  await page.keyboard.press("S");
  await expect(finance.getByRole("button", { name: "1 Groceries" })).toBeVisible();
  await page.keyboard.press("O");
  await expect(finance.getByRole("heading", { name: "Mine ›" })).toBeVisible();

  await page.keyboard.press("1");
  // A key after it that the pane does take: once it has, the 1 before it had its turn.
  await page.keyboard.press("[");

  await expect(month(finance, "September 2026")).toBeVisible();
  expect(sentTo("PUT")).toEqual([]);
});

test("#1036 a refused limit keeps the field open with what was typed", async ({ page }) => {
  const detail = "Only a spending category takes a limit";
  const { finance, sentTo } = await open(page, {
    "PUT /api/finance/categories/5/limit": async () => ({ status: 422, json: { detail } }),
  });
  await budget(page, finance);

  await page.keyboard.press("e");
  await limit(finance).fill("1.700");
  await limit(finance).press("Enter");

  await expect.poll(() => sentTo("PUT")).toHaveLength(1);
  await expect(limit(finance)).toHaveValue("1.700");
});

test("#1036 while a pull waits the button says so and P asks no more", async ({ page }) => {
  const { finance, sentTo } = await open(page, {
    "GET /api/finance/sync": {
      ...SYNC,
      requested_at: "2026-10-25T08:00:00Z",
      last_success_at: null,
    },
  });
  await expect(finance.getByRole("button", { name: "Waiting for the bank job…" })).toBeDisabled();

  await page.keyboard.press("P");
  await page.keyboard.press("[");

  await expect(month(finance, "September 2026")).toBeVisible();
  expect(sentTo("POST")).toEqual([]);
});

test("#1036 a failed read of the bank job shows as an alert", async ({ page }) => {
  const { finance } = await open(page, { "GET /api/finance/sync": async () => ({ status: 503 }) });

  await expect(
    finance.getByRole("alert").filter({ hasText: "GET /api/finance/sync failed with 503" }),
  ).toBeVisible();
});

const readout = (finance: Locator) => finance.locator(".finance-sankey .finance-trend-readout");

/** The sankey's category node, by click or, on a phone, by tap; the drilldown's read and crumbs follow. */
async function intoGroceries(page: Page, finance: Locator, sentTo: (start: string) => string[]) {
  const groceries = finance.getByRole("button", { name: /^Groceries, 400\s€.*open the category$/ });
  if (onPhone(page)) {
    // The first tap only names the node: its words grow the readout, so the click lands below (#2236).
    await groceries.tap();
    await expect(readout(finance)).toHaveText(/^Groceries, 400\s€, 13% of the money in$/);
    await groceries.tap();
  } else await groceries.click();
  await expect
    .poll(() => sentTo("GET /api/finance/drill/categories/4?").join())
    .toMatch(/month=2026-10&from=2026-10/);
  await expect(crumbs(page)).toHaveText(["October 2026", "Groceries"]);
}

test("#1082 the sankey says where the money went, and a category opens its drilldown", async ({
  page,
}) => {
  const { finance, sentTo } = await open(page);
  const head = finance.getByText(/^October 2026 so far: 3.000\s€ in, 400\s€ out/).first();
  await expect(head).toHaveText(/^October 2026 so far: 3.000\s€ in, 400\s€ out, 2.600\s€ left$/);
  await expect(finance.getByText(/The most went to Groceries 400\s€\./)).toBeVisible();

  const left = /^Left over from Mine, 2.600\s€, 87% of the money in$/;
  // Off the chart, so no band the pointer rests on names itself instead.
  await page.mouse.move(0, 0);
  await finance.getByRole("button", { name: left }).focus();
  await expect(readout(finance)).toHaveText(left);

  await intoGroceries(page, finance, sentTo);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#1082 a sankey category opens its drilldown by tap", async ({ page }) => {
    const { finance, sentTo } = await open(page);
    await intoGroceries(page, finance, sentTo);
  });
});
