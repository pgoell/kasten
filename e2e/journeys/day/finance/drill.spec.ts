import { phone } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import {
  BOOKING,
  CATEGORY,
  crumbs,
  drills,
  never,
  openBooking,
  openFinance,
  PAYEE,
  split,
} from "./finance.ts";

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("#1083 a scope opens from its card, shows its month and accounts, and Escape steps back", async ({
  page,
}) => {
  const { finance, sentTo } = await openFinance(page, drills());

  await finance.getByRole("button", { name: "Mine ›" }).click();

  const card = finance.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Mine in October 2026" }),
  });
  await expect(card.getByRole("row")).toHaveText([
    "Income3.000 €",
    "Into household−900 €",
    "Flexible−100 €",
    "Saved−300 €",
  ]);
  expect(sentTo("GET /api/finance/drill/scopes/")).toEqual([
    "GET /api/finance/drill/scopes/mine?month=2026-10&from=2026-10&months=12",
  ]);
  await expect(crumbs(page)).toHaveText(["October 2026", "Mine"]);

  await finance.getByRole("button", { name: /^Giro, 2026-10-02 ›/ }).click();
  await expect(crumbs(page)).toHaveText(["October 2026", "Mine", "Giro"]);
  expect(sentTo("GET /api/finance/drill/accounts/")).toEqual([
    "GET /api/finance/drill/accounts/1?month=2026-10&from=2026-10&months=12",
  ]);

  await page.keyboard.press("Escape");
  await expect(crumbs(page)).toHaveText(["October 2026", "Mine"]);
  await page.keyboard.press("Escape");
  await expect(crumbs(page)).toHaveCount(0);
  await expect(finance.getByRole("button", { name: "Mine ›" })).toBeVisible();
});

test("#1083 a category leads to its payee, which takes a default category or a rule", async ({
  page,
}) => {
  const { finance, sentTo } = await openFinance(page, drills());
  await openBooking(page);

  await finance.getByRole("button", { name: "Groceries ›" }).click();
  await expect(
    finance.getByText(
      /^October 2026 so far: 100\s€; a year before 80\s€; 6-month average 380\s€; 400\s€ available$/,
    ),
  ).toBeVisible();
  await expect(finance.getByText("rule: payee starts with “rewe”")).toBeVisible();

  await finance.getByRole("button", { name: /^REWE ›/ }).click();
  await expect(
    finance.getByText(/average 90\s€ a month; 50\s€ a booking in October 2026/),
  ).toBeVisible();
  await expect(crumbs(page)).toHaveText(["October 2026", "REWE", "Groceries", "REWE"]);

  await finance.getByRole("combobox", { name: "Category for REWE" }).selectOption("6");
  await finance.getByRole("button", { name: "Make it the default" }).click();
  await expect.poll(() => sentTo("PUT")).toEqual(['PUT /api/finance/payees/5 {"category_id":6}']);
  await finance.getByRole("button", { name: "Add a rule" }).click();
  await expect
    .poll(() => sentTo("POST"))
    .toEqual(['POST /api/finance/rules {"kind":"payee","pattern":"rewe markt","category_id":6}']);
});

test("#1083 a category lists a split booking by its part in that category, so the net is its own", async ({
  page,
}) => {
  const bookings = [split(6)];
  const answers = drills({ "GET /api/finance/drill/categories/4": { ...CATEGORY, bookings } });
  const { finance } = await openFinance(page, answers);
  await openBooking(page);

  await finance.getByRole("button", { name: "Groceries ›" }).click();

  const region = finance.getByRole("region", { name: "Bookings" });
  await expect(region.getByRole("heading")).toHaveText("1 booking, −70,00 € net");
  await expect(region.getByText(/^part of −100,00\s€, REWE SAGT DANKE$/)).toBeVisible();
});

test("#1083 stepping back finds the tab's filter and the list's cursor as they were", async ({
  page,
}) => {
  const edeka = { ...BOOKING, id: 10, counterparty_name: "EDEKA", purpose: "EDEKA SAGT DANKE" };
  const answers = drills({
    "GET /api/finance/drill/categories/4": { ...CATEGORY, bookings: [BOOKING, edeka] },
    "GET /api/finance/drill/bookings/10": never,
  });
  const { finance, sentTo } = await openFinance(page, answers);
  await page.keyboard.press("T");
  await finance.getByRole("searchbox", { name: "Text" }).fill("rewe");
  await expect(finance.getByText("REWE SAGT DANKE")).toBeVisible();
  await finance.focus();
  await page.keyboard.press("Enter");
  await finance.getByRole("button", { name: "Groceries ›" }).click();
  await expect(finance.getByText("EDEKA SAGT DANKE")).toBeVisible();

  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => sentTo("GET /api/finance/drill/bookings/").at(-1))
    .toBe("GET /api/finance/drill/bookings/10");
  await page.keyboard.press("Escape");

  const rows = finance.getByRole("list", { name: "Bookings" }).getByRole("listitem");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(finance.getByRole("searchbox", { name: "Text" })).toHaveValue("rewe");
});

test("#2232 a drilldown that falls back to its waiting line takes no keys; back, the tab has them", async ({
  page,
}) => {
  let reads = 0;
  const category = async () => ({ json: reads++ === 0 ? CATEGORY : { ...CATEGORY, months: [] } });
  const answers = drills({ "GET /api/finance/drill/categories/4": category });
  const { finance, sentTo } = await openFinance(page, answers);
  await openBooking(page);
  await finance.getByRole("button", { name: "Groceries ›" }).click();
  const bookings = finance.getByRole("list", { name: "Bookings" });
  await expect(bookings).toBeVisible();

  await page.keyboard.press("[");
  await expect(bookings).toHaveCount(0);
  const opened = sentTo("GET /api/finance/drill/bookings/").length;
  await page.keyboard.press("Enter");
  // Booking 9 is in the cache, so an Enter that opened it would send nothing: read the crumbs.
  await expect(crumbs(page)).toHaveText(["September 2026", "REWE", "Groceries"]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("1");

  await expect
    .poll(() => sentTo("PUT"))
    .toEqual(['PUT /api/finance/transactions/9/category {"category_id":4}']);
  expect(sentTo("GET /api/finance/drill/bookings/")).toHaveLength(opened);
});

test("#1083 a month's bar keeps the keys in the pane, so Escape still steps back", async ({
  page,
}) => {
  const [october] = CATEGORY.months;
  const september = { ...october, month: "2026-09", total: "80.00" };
  const answers = drills({
    "GET /api/finance/drill/categories/4": { ...CATEGORY, months: [september, october] },
  });
  const { finance, sentTo } = await openFinance(page, answers);
  await openBooking(page);
  await finance.getByRole("button", { name: "Groceries ›" }).click();

  await finance.getByRole("button", { name: /^September 2026, 80\s€$/ }).click();

  await expect.poll(() => sentTo("GET /api/finance/drill/categories/")).toHaveLength(2);
  await expect(finance).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(crumbs(page)).toHaveText(["September 2026", "REWE"]);
});

test("#1083 a payee that only pays in averages its money in", async ({ page }) => {
  const received = { month: "2026-10", spent: "0.00", received: "3000.00", saved: "0.00" };
  const payee = {
    ...PAYEE,
    months: [{ ...received, bookings: 1 }],
    average: "0.00",
    average_received: "3000.00",
  };
  const { finance } = await openFinance(page, drills({ "GET /api/finance/drill/payees/5": payee }));
  await openBooking(page);

  await finance.getByRole("button", { name: "REWE ›" }).click();

  await expect(finance.getByText(/^average 3.000\s€ a month$/)).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#1083 a scope and its account open by tap, each a breadcrumb further", async ({ page }) => {
    const { finance, sentTo } = await openFinance(page, drills());

    await finance.getByRole("button", { name: "Mine ›" }).tap();
    await expect(finance.getByRole("heading", { name: "Mine in October 2026" })).toBeVisible();
    await finance.getByRole("button", { name: /^Giro, 2026-10-02 ›/ }).tap();

    await expect(crumbs(page)).toHaveText(["October 2026", "Mine", "Giro"]);
    expect(sentTo("GET /api/finance/drill/accounts/")).toHaveLength(1);
  });
});
