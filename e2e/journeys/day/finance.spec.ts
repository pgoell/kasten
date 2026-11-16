import type { Locator, Page } from "@playwright/test";
import { openApp } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

/** CDP's modifier bits. AltGr reads as Ctrl+Alt on Windows; Option is Alt on a Mac. */
const ALT = 1;
const CTRL = 2;

/** Types `key` the way a German layout does: AltGr+8 or Option+5 for `[`, AltGr+9 or Option+6 for `]`. */
async function typeHeld(page: Page, key: "[" | "]", modifiers: number) {
  const code =
    modifiers & CTRL ? (key === "[" ? "Digit8" : "Digit9") : key === "[" ? "Digit5" : "Digit6";
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await cdp.detach();
}

for (const vim of ["on", "off"]) {
  test(`[ and ] typed through AltGr or Option step the finance pane's month, vim ${vim}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    await openApp(page);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the finance pane/ }).click();
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
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /^Open the finance pane/ }).click();
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
