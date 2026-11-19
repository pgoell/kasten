import type { Locator, Page } from "@playwright/test";
import { openApp, runCommand, today } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { ALT, CTRL, typeHeld } from "./finance.ts";

for (const vim of ["on", "off"]) {
  test(`[ and ] typed through AltGr or Option step the finance pane's month, vim ${vim}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    await openApp(page);
    await runCommand(page, /^Open the finance pane/);
    const finance = page.getByRole("region", { name: "Finance" });
    const month = finance.getByRole("heading", { name: /^\w+ \d{4}$/ });
    await expect(month).toBeVisible();
    const shown = await month.textContent();
    await finance.focus();

    await typeHeld(page, "[", CTRL | ALT);
    await expect(month).not.toHaveText(shown ?? "");
    const before = await month.textContent();
    await typeHeld(page, "[", ALT);
    await expect(month).not.toHaveText(before ?? "");
    await typeHeld(page, "]", ALT);
    await expect(month).toHaveText(before ?? "");
    await typeHeld(page, "]", CTRL | ALT);
    await expect(month).toHaveText(shown ?? "");

    // A real chord is not the pane's: Ctrl+[ steps no month.
    await page.keyboard.press("Control+BracketLeft");
    await expect(month).toHaveText(shown ?? "");
  });
}

const CATEGORIES = [
  { id: 7, name: "Food", kind: "flexible" },
  { id: 9, name: "Shopping", kind: "flexible" },
];
const BAKERY = {
  id: 1,
  account_id: 1,
  booking_date: "2026-10-01",
  amount: "-4.20",
  currency: "EUR",
  purpose: "Brot",
  counterparty_name: "Bäckerei Müller",
  payee_id: 3,
  payee_name: "Bäckerei Müller",
  splits: [],
};
// No payee, and one loose split that sorts by its own id.
const ORDER = {
  ...BAKERY,
  id: 2,
  booking_date: "2026-10-02",
  amount: "-30.00",
  purpose: "AMAZON",
  payee_id: null,
  payee_name: null,
  counterparty_name: "Amazon",
  splits: [{ id: 11, amount: "-10.00", text: "Cable" }],
};
const charge = (
  id: number,
  amount: string,
  status: string,
  transaction_id: number | null = null,
) => ({
  id,
  kind: "charge",
  key: `k${id}`,
  charged_on: "2026-10-17",
  amount,
  transaction_id,
  status,
  items: [],
});
const order = (
  id: number,
  source: string,
  merchant: string,
  total: string,
  charges: unknown[],
) => ({
  id,
  source,
  order_key: `o${id}`,
  ordered_on: `2026-10-${18 - id}`,
  merchant,
  total,
  currency: "EUR",
  charges,
});

/**
 * Answers the to-sort list's reads with two bookings and keeps each sort the page sends, as
 * `path body`. A sort waits on `gate` while one is set.
 */
async function toSort(page: Page, orders: unknown[] = []) {
  const sorts: string[] = [];
  const box = { gate: Promise.resolve() };
  await page.route("**/api/finance/categories", (route) => route.fulfill({ json: CATEGORIES }));
  await page.route("**/api/finance/to-sort?*", (route) =>
    route.fulfill({ json: { total: 2, bookings: [BAKERY, ORDER] } }),
  );
  await page.route("**/api/finance/orders/unmatched", (route) => route.fulfill({ json: orders }));
  await page.route(
    /\/api\/finance\/(transactions|splits|payees)\/\d+(\/category)?$/,
    async (route) => {
      const request = route.request();
      if (request.method() !== "PUT") return route.fallback();
      sorts.push(`${new URL(request.url()).pathname} ${request.postData()}`);
      await box.gate;
      return route.fulfill({ status: 204 });
    },
  );
  await openApp(page);
  await runCommand(page, /^Open the finance pane/);
  const finance = page.getByRole("region", { name: "Finance" });
  await finance.getByRole("tab", { name: /^To sort/ }).click();
  await expect(finance.getByText("Cable")).toBeVisible();
  await finance.focus();
  return { finance, sorts, box };
}

const food = (finance: Locator) => finance.getByRole("button", { name: "1 Food" });

test("#1039 lists each order charge no booking holds, and why, under the bookings", async ({
  page,
}) => {
  const { finance } = await toSort(page, [
    order(1, "paypal", "Example Shop GmbH", "30.00", [charge(1, "30.00", "ambiguous")]),
    order(3, "amazon", "Amazon", "40.00", [
      charge(2, "25.00", "split", 9),
      charge(3, "15.00", "items_off"),
    ]),
    order(4, "amazon", "Amazon", "12.00", []),
  ]);
  const lines = finance.getByRole("region", { name: "Orders without a booking" }).locator("li");

  await expect(lines).toHaveText([
    "2026-10-17, Example Shop GmbH, 30,00 €: two bookings fit alike",
    "2026-10-15, Amazon, 15,00 €: its items do not add up",
    "2026-10-14, Amazon, 12,00 €: not dispatched yet",
  ]);
});

test("#1035 shows a row per booking and per loose split, oldest first, with a key per category", async ({
  page,
}) => {
  const { finance } = await toSort(page);
  const rows = finance.getByRole("list", { name: "Bookings to sort" }).getByRole("listitem");

  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Bäckerei Müller");
  await expect(rows.nth(1)).toContainText("Amazon");
  await expect(rows.nth(1)).toContainText("Cable");
  await expect(food(finance)).toBeVisible();
  await expect(finance.getByRole("button", { name: "2 Shopping" })).toBeVisible();
});

test("#1035 a category key sorts the cursor's row by hand, a split by its own id", async ({
  page,
}) => {
  const { finance, sorts } = await toSort(page);

  await page.keyboard.press("1");
  // The next sort waits until this one is written.
  await expect(food(finance)).toBeEnabled();
  await page.keyboard.press("j");
  await page.keyboard.press("2");

  await expect
    .poll(() => sorts)
    .toEqual([
      '/api/finance/transactions/1/category {"category_id":7}',
      '/api/finance/splits/11/category {"category_id":9}',
    ]);
});

test("#1035 always for this payee sorts the payee, by key and by tap", async ({ page }) => {
  const { finance, sorts } = await toSort(page);

  await page.keyboard.press("a");
  await page.keyboard.press("2");
  await expect.poll(() => sorts).toEqual(['/api/finance/payees/3 {"category_id":9}']);
  await expect(food(finance)).toBeEnabled();

  await finance.getByRole("list", { name: "Bookings to sort" }).getByRole("button").nth(1).click();
  await finance.getByRole("button", { name: "a Always for this payee" }).click();
  await food(finance).click();

  await expect(page.getByText("This booking has no payee to sort")).toBeVisible();
  expect(sorts).toHaveLength(1);
});

test("#1035 a key held with Ctrl, Alt or Meta sorts nothing, and a plain one sorts", async ({
  page,
}) => {
  const { sorts } = await toSort(page);

  for (const held of ["Control", "Alt", "Meta"]) await page.keyboard.press(`${held}+1`);
  await page.keyboard.press("2");

  await expect
    .poll(() => sorts)
    .toEqual(['/api/finance/transactions/1/category {"category_id":9}']);
});

test("#1035 a second press while a sort is in the air sorts nothing more", async ({ page }) => {
  const { finance, sorts, box } = await toSort(page);
  let finish: () => void = () => {};
  box.gate = new Promise((done) => {
    finish = done;
  });

  await page.keyboard.press("1");
  await expect.poll(() => sorts).toHaveLength(1);
  await page.keyboard.press("2");
  await expect(food(finance)).toBeDisabled();
  finish();

  await expect(food(finance)).toBeEnabled();
  expect(sorts).toEqual(['/api/finance/transactions/1/category {"category_id":7}']);
  await expect(finance.getByText("2 to sort")).toBeVisible();
});

const THALIA = {
  transaction_id: 5,
  booking_date: "2026-03-04",
  payee: "Thalia",
  amount: "-400.00",
};
const LINE = { form_line: "werbungskosten", label: "Werbungskosten (Anlage N)", total: "1400.00" };
const YEAR = {
  lines: [{ ...LINE, bookings: 2, missing: 1 }],
  allowance: "1230.00",
  werbungskosten_over: "170.00",
  missing: [THALIA],
  money_back: [],
  entries: [{ ...THALIA, form_line: "werbungskosten" }],
};
const proposal = (shared: boolean, tax_amount: string | null) => ({
  receipt: { id: 3, name: "R.pdf", read_at: "2026-10-26T10:00:00Z", read_error: null },
  form_line: "handwerker",
  candidates: [
    { transaction_id: 9, booking_date: "2026-10-28", amount: "-476.00", payee: "Huber GmbH" },
  ].map((candidate) => ({ ...candidate, purpose: null, tax_amount, shared })),
});

/**
 * Answers the tax reads, the receipts to sort with `queue` and booking 5's tax with `tax`, and
 * keeps each tax write the page sends, as `METHOD path body`. A confirm answers `confirm`.
 */
async function taxRoutes(page: Page, queue: unknown[] = [], tax: unknown = {}, confirm = 204) {
  const writes: string[] = [];
  const years: string[] = [];
  await page.route("**/api/finance/tax/*", (route) => {
    const year = Number(new URL(route.request().url()).pathname.split("/").pop());
    years.push(String(year));
    return route.fulfill({ json: { ...YEAR, year } });
  });
  await page.route("**/api/finance/drill/bookings/5", (route) =>
    route.fulfill({
      json: {
        transaction: { ...BAKERY, id: 5, imported_at: "2026-03-05T08:00:00", source_key: "s5" },
        account: { id: 1, name: "Giro", bank: null, iban: null, kind: "giro", shared: false },
        ...{ payee: null, twin: null, plans: [], order: null, counts: [] },
      },
    }),
  );
  await page.route(/\/api\/finance\/(receipts|transactions\/5\/tax)/, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") {
      return route.fulfill({ json: path.endsWith("to-sort") ? queue : { receipts: [], ...tax } });
    }
    writes.push(`${request.method()} ${path} ${request.postData()}`);
    const held = path.endsWith("confirm") && confirm === 409 && writes.length === 1;
    const detail = { code: "mark_exists", message: "Already marked 400.00" };
    return route.fulfill(held ? { status: 409, json: { detail } } : { status: 204 });
  });
  return { writes, years };
}

/** Opens the Tax tab by its key, and from it booking 5's tax card. */
async function taxCard(page: Page) {
  await openApp(page);
  await runCommand(page, /^Open the finance pane/);
  const finance = page.getByRole("region", { name: "Finance" });
  await finance.focus();
  await page.keyboard.press("X");
  await finance
    .getByRole("button", { name: /2026-03-04, Thalia/ })
    .first()
    .click();
  return finance.getByRole("article", { name: "Tax and receipts" });
}

test("#1040 the Tax tab shows each line's year, what is over the allowance and missing", async ({
  page,
}) => {
  const { years } = await taxRoutes(page);
  await openApp(page);
  await runCommand(page, /^Open the finance pane/);
  const finance = page.getByRole("region", { name: "Finance" });
  await finance.focus();
  const year = Number(today().slice(0, 4));

  await page.keyboard.press("X");

  await expect(finance.getByText(`Tax year ${year}`)).toBeVisible();
  await expect(finance.getByRole("row", { name: /Anlage N\) \(2\)/ })).toContainText("1.400,00 €");
  await expect(finance.getByText(/170,00\s€ over the allowance of 1\.230,00\s€/)).toBeVisible();
  await expect(finance.getByRole("button", { name: /2026-03-04, Thalia/ })).toHaveCount(2);
  const csv = `/api/finance/tax/${year}/lines/werbungskosten.csv`;
  await expect(finance.getByRole("link", { name: "CSV" })).toHaveAttribute("href", csv);

  await typeHeld(page, "]", CTRL | ALT);

  await expect(finance.getByText(`Tax year ${year + 1}`)).toBeVisible();
  expect(years.at(-1)).toBe(String(year + 1));
  const zip = `/api/finance/tax/${year + 1}/receipts.zip`;
  await expect(finance.getByRole("link", { name: /ZIP/ })).toHaveAttribute("href", zip);
});

const CONFIRM = "POST /api/finance/receipts/3/confirm";
const ASIDE = 'PATCH /api/finance/receipts/3 {"dismissed":true}';

test("#1040 a receipt's proposal confirms only when pressed, then Put aside", async ({ page }) => {
  const { writes } = await taxRoutes(page, [proposal(false, "300.00")]);
  const { finance } = await toSort(page);
  const press = finance.getByRole("button", { name: /2026-10-28, Huber GmbH/ });

  await expect(press).toHaveText(/§35a Handwerker \(Arbeitskosten\) 300,00\s€$/);
  await press.click();
  await expect.poll(() => writes).toHaveLength(1);
  await finance.getByRole("button", { name: "Put aside" }).click();

  const body = { transaction_id: 9, form_line: "handwerker", tax_amount: "300.00" };
  const sent = JSON.stringify({ ...body, replace: false, receipt_needed: true });
  await expect.poll(() => writes).toEqual([`${CONFIRM} ${sent}`, ASIDE]);
});

test("#1040 a proposal on the shared account asks your share and sends it", async ({ page }) => {
  const { writes } = await taxRoutes(page, [proposal(true, null)]);
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.type());
    void dialog.accept("400,00");
  });
  const { finance } = await toSort(page);

  await finance.getByRole("button", { name: /your share/ }).click();

  await expect.poll(() => writes).toHaveLength(1);
  expect(asked).toEqual(["prompt"]);
  expect(JSON.parse(writes[0].slice(CONFIRM.length))).toMatchObject({ tax_amount: "400.00" });
});

test("#1040 a mark the booking holds is replaced only when you say so", async ({ page }) => {
  const { writes } = await taxRoutes(page, [proposal(false, "800.00")], {}, 409);
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(`${dialog.type()} ${dialog.message()}`);
    void dialog.dismiss();
  });
  const { finance } = await toSort(page);

  await finance.getByRole("button", { name: /Huber GmbH/ }).click();
  await expect.poll(() => asked).toEqual(["confirm Already marked 400.00?"]);
  await finance.getByRole("button", { name: "Put aside" }).click();

  await expect.poll(() => writes.at(-1)).toBe(ASIDE);
  expect(writes.filter((write) => write.startsWith(CONFIRM))).toHaveLength(1);
});

test("#1040 a tax card saves a German amount and keeps a dropped file", async ({ page }) => {
  const { writes } = await taxRoutes(page, [], { mark: null });
  const card = await taxCard(page);

  await card.getByLabel("Line").selectOption("werbungskosten");
  await card.getByLabel("Tax amount").fill("1.200,50");
  await card.getByRole("button", { name: "Save the mark" }).click();
  const mark = { form_line: "werbungskosten", tax_amount: "1200.50", receipt_needed: true };
  const put = `PUT /api/finance/transactions/5/tax-mark ${JSON.stringify({ ...mark, note: null })}`;
  await expect.poll(() => writes).toEqual([put]);

  const files = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["%PDF-1"], "Rechnung.pdf", { type: "application/pdf" }));
    return data;
  });
  await card.dispatchEvent("drop", { dataTransfer: files });

  await expect.poll(() => writes).toHaveLength(2);
  expect(writes[1]).toMatch(/^POST \/api\/finance\/receipts .*filename="Rechnung\.pdf"/s);
  expect(writes[1]).toMatch(/name="transaction_id"\r\n\r\n5\r\n/);
});

test("#1040 a tax card shows the receipt's status and takes a receipt off", async ({ page }) => {
  const mark = { form_line: "sonderausgaben", tax_amount: "50.00", receipt_needed: true };
  const tax = { mark: { ...mark, note: null, receipt_status: "attached" } };
  const { writes } = await taxRoutes(page, [], { ...tax, receipts: [{ id: 8, name: "S.pdf" }] });
  const card = await taxCard(page);

  await expect(card.getByText("50,00 € counts, receipt attached")).toBeVisible();
  await expect(card.getByRole("link", { name: "S.pdf" })).toHaveAttribute(
    "href",
    "/api/finance/receipts/8/file",
  );
  await card.getByRole("button", { name: "Take off" }).click();

  await expect
    .poll(() => writes)
    .toEqual(['PATCH /api/finance/receipts/8 {"transaction_id":null}']);
});

/** Opens the finance pane over a 12-month trend answer of `totals`, the last on the month shown. */
async function spending(page: Page, totals: number[]) {
  await page.route("**/api/finance/budget/trend?*", (route) => {
    const at = new URL(route.request().url()).searchParams.get("month") ?? "";
    const months = totals.map((_, i) =>
      new Date(Date.UTC(+at.slice(0, 4), +at.slice(5) - totals.length + i, 1))
        .toISOString()
        .slice(0, 7),
    );
    const limits = totals.map(() => null);
    route.fulfill({ json: { months, categories: [], totals: totals.map(String), limits } });
  });
  await openApp(page);
  await runCommand(page, /^Open the finance pane/);
  const finance = page.getByRole("region", { name: "Finance" });
  const chart = finance.getByRole("img", {
    name: `spending per month over ${totals.length} months`,
  });
  await expect(chart.locator("rect")).toHaveCount(totals.length);
  return { finance, chart };
}

/** Each bar's top and height, and the solid lines' heights, in the chart's own units. */
const drawn = (chart: Locator) =>
  chart.evaluate((svg: SVGSVGElement) => ({
    bars: [...svg.querySelectorAll("rect")].map((bar) => [bar.getBBox().y, bar.getBBox().height]),
    solid: [...svg.querySelectorAll("line")]
      .filter((line) => getComputedStyle(line).strokeDasharray === "none")
      .map((line) => line.y1.baseVal.value),
  }));

test("#2184 months spent above zero stand on the chart's bottom edge, with no zero line", async ({
  page,
}) => {
  const { chart } = await spending(page, [40, 80]);
  expect(await drawn(chart)).toEqual({
    bars: [
      [40, 40],
      [0, 80],
    ],
    solid: [],
  });
});

test("#2184 a month whose refunds beat its spending hangs below a zero line, its amount named", async ({
  page,
}) => {
  const { finance, chart } = await spending(page, [60, -20]);
  expect(await drawn(chart)).toEqual({
    bars: [
      [0, 60],
      [60, 20],
    ],
    solid: [60],
  });
  await expect(finance.locator(".finance-trend-readout")).toHaveText(/^\w+ \d{4} −20\s€$/);
  await expect(finance.getByRole("button", { name: /^\w+ \d{4}, −20\s€ spent$/ })).toBeVisible();
});
