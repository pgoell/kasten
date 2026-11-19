import { expect, test } from "../../../harness/stack.ts";
import { DRILLED, drills, openBooking, openFinance, split } from "./finance.ts";

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("#1083 a booking shows where it counts, re-sorts by key and splits into parts that add up", async ({
  page,
}) => {
  const { finance, sentTo } = await openFinance(page, drills());
  await openBooking(page);

  await expect(finance.getByText(/^October 2026, mine, flexible, Groceries/)).toBeVisible();
  await expect(finance.getByText("Kartenzahlung")).toBeVisible();
  expect(sentTo("GET /api/finance/drill/bookings/")).toEqual(["GET /api/finance/drill/bookings/9"]);

  // The second category's key, as on the to-sort list.
  await page.keyboard.press("2");
  await expect
    .poll(() => sentTo("PUT"))
    .toEqual(['PUT /api/finance/transactions/9/category {"category_id":6}']);

  await finance.getByRole("button", { name: "Split into parts" }).click();
  await finance.getByRole("textbox", { name: "Part 1 amount" }).fill("-70,00");
  await expect(finance.getByText(/30,00\s€ still to share out/)).toBeVisible();
  const save = finance.getByRole("button", { name: "Save the splits" });
  await expect(save).toBeDisabled();
  await finance.getByRole("button", { name: "Add a part" }).click();
  await save.click();
  const parts = '[{"amount":"-70.00","text":null},{"amount":"-30.00","text":null}]';
  await expect
    .poll(() => sentTo("PUT /api/finance/transactions/9/splits"))
    .toEqual([`PUT /api/finance/transactions/9/splits ${parts}`]);
});

const charge = (status: string) => ({
  ...{ id: 5, kind: "charge", key: "k5", charged_on: "2026-10-04", amount: "100.00" },
  transaction_id: 9,
  status,
  items: [
    { text: "Lamp", amount: "70.00" },
    { text: "2 x Light bulb", amount: "30.00" },
  ],
});
const order = (status: string) => ({
  order: {
    ...{ id: 3, source: "amazon", order_key: "123-4567890-1234567", ordered_on: "2026-10-03" },
    ...{ merchant: "Amazon", total: "100.00", currency: "EUR", charges: [charge(status)] },
  },
  charge_id: 5,
});

test("#1039 a booking an order paid shows the order and its items", async ({ page }) => {
  const drilled = { ...DRILLED, order: order("split") };
  const { finance } = await openFinance(
    page,
    drills({ "GET /api/finance/drill/bookings/9": drilled }),
  );
  await openBooking(page);

  const card = finance.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Amazon order" }),
  });
  await expect(card.getByText(/123-4567890-1234567, ordered 2026-10-03/)).toBeVisible();
  await expect(card.getByText(/^Split into the items below/)).toBeVisible();
  await expect(card.getByRole("row")).toHaveText(["Lamp70,00 €", "2 x Light bulb30,00 €"]);
});

for (const [status, says] of [
  ["kept", /^You had sorted or split this booking by hand/],
  ["unsplit", /^You took away the split into these items/],
] as const) {
  test(`#1039 an order's booking whose split is ${status} says so`, async ({ page }) => {
    const drilled = { ...DRILLED, order: order(status) };
    const answers = drills({ "GET /api/finance/drill/bookings/9": drilled });
    const { finance } = await openFinance(page, answers);
    await openBooking(page);

    await expect(finance.getByText(says)).toBeVisible();
  });
}

test("#1083 a category key on a split booking says to sort its parts", async ({ page }) => {
  const drilled = { ...DRILLED, transaction: split(null) };
  const answers = drills({ "GET /api/finance/drill/bookings/9": drilled });
  const { finance, sentTo } = await openFinance(page, answers);
  await openBooking(page);
  await expect(finance.getByText("Part 1, −70,00 €, food")).toBeVisible();

  await page.keyboard.press("2");

  await expect(page.getByText("This booking is split: sort each part below")).toBeVisible();
  expect(sentTo("PUT")).toEqual([]);
});

test("#1083 a split the server refuses, such as of a move between own accounts, says why", async ({
  page,
}) => {
  const why = "A move between own accounts is no spending and cannot be split into categories";
  const refuse = async () => ({ status: 422, json: { detail: why } });
  const answers = drills({ "PUT /api/finance/transactions/9/splits": refuse });
  const { finance } = await openFinance(page, answers);
  await openBooking(page);

  await finance.getByRole("button", { name: "Split into parts" }).click();
  await finance.getByRole("button", { name: "Save the splits" }).click();

  await expect(page.getByText(why)).toBeVisible();
});
