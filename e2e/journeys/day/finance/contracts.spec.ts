import { expect, test } from "../../../harness/stack.ts";
import { openPlans, PLAN, PROPOSAL } from "./finance.ts";

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const ROW = {
  ...{ plan_id: null, plan_name: null, amount: null, every_months: null, yearly: null },
  ...{ cancel_by: null, renews: null, ends: null, problem: null, rise: null },
};
const DATES = { cancel_by: "2026-11-28", renews: "2027-03-01" };

test("#1675 the contracts list by cancel-by date, with its plan, cost a year and the total", async ({
  page,
}) => {
  const contracts = [
    { ...ROW, path: "c/Gym.md", name: "Gym", cancel_by: "2026-11-14", renews: "2027-01-15" },
    {
      ...{ ...ROW, ...DATES, path: "c/Haftpflicht.md", name: "Haftpflicht" },
      ...{ plan_id: 3, plan_name: "HUK", amount: "-600.00", every_months: 12, yearly: "600.00" },
    },
    { ...ROW, ...DATES, path: "c/Phone.md", name: "Phone", plan_id: 9, problem: "plan 9 is gone" },
    { ...ROW, path: "c/Paper.md", name: "Paper", problem: "term missing or unreadable" },
  ];
  const answer = { contracts, yearly: "600.00" };
  const { finance, sentTo } = await openPlans(page, { "GET /api/finance/contracts": answer });

  const list = finance.getByRole("region", { name: "Contracts" });
  await expect(list.getByRole("listitem")).toHaveText([
    "Gymcancel by 14 Nov 2026, else renews 15 Jan 2027; no plan",
    "Haftpflicht600 € a yearcancel by 28 Nov 2026, else renews 1 Mar 2027; HUK, −600,00 € yearly",
    "Phonecancel by 28 Nov 2026, else renews 1 Mar 2027; plan 9 is gone",
    "Paperterm missing or unreadable; no plan",
  ]);
  await expect(list.getByText("600 € a year in all")).toBeVisible();
  expect(sentTo("GET /api/finance/contracts")).toEqual([
    "GET /api/finance/contracts?today=2026-10-25",
  ]);
});

test("#1679 a contract whose price rose shows the old and the new amount beside it", async ({
  page,
}) => {
  const gym = {
    ...{ ...ROW, path: "c/Gym.md", name: "Gym", plan_id: 4, plan_name: "Gym", amount: "-39.00" },
    ...{ every_months: 1, yearly: "468.00", cancel_by: "2026-11-14", renews: "2027-01-15" },
    rise: { old: "-39.00", new: "-44.00" },
  };
  const contracts = [gym, { ...gym, path: "c/Pay.md", name: "Pay", rise: null }];
  const answer = { contracts, yearly: "936.00" };
  const { finance } = await openPlans(page, { "GET /api/finance/contracts": answer });

  const rows = finance.getByRole("region", { name: "Contracts" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByText(/^Price rose/)).toHaveText(
    "Price rose from −39,00 € to −44,00 €",
  );
  await expect(rows.nth(1)).not.toContainText("Price rose");
});

const MADE = "03 Areas/03 Money/Contracts/Haftpflicht.md";

test("#1675 a plan's and a proposal's Contract button start the note and say where, the proposal confirmed first by its new id", async ({
  page,
}) => {
  let notes = 0;
  const contract = async () =>
    ++notes === 3
      ? { status: 409, json: { detail: "A note is already there" } }
      : { status: 201, json: { path: MADE } };
  const { finance, sentTo } = await openPlans(page, {
    "GET /api/finance/plans": [{ ...PROPOSAL, id: 3, reserves: true, share: "41.50" }],
    "POST /api/finance/plans": { id: 41 },
    "POST /api/finance/contracts": contract,
  });
  const buttons = finance.getByRole("button", { name: "Make a contract note for Haftpflicht" });
  const writes = () => sentTo("POST /api/finance/").filter((line) => !line.includes("reminders"));

  await buttons.nth(1).click();
  await expect(page.getByText(`Wrote ${MADE}: fill in its terms there.`)).toBeVisible();
  expect(writes()).toEqual(['POST /api/finance/contracts {"plan_id":3}']);

  await buttons.nth(0).click();
  await expect.poll(() => writes()).toHaveLength(3);
  expect(writes().slice(1)).toEqual([
    `POST /api/finance/plans?today=2026-10-25 ${JSON.stringify(PLAN)}`,
    'POST /api/finance/contracts {"plan_id":41}',
  ]);

  await buttons.nth(1).click();
  await expect(page.getByText("A note is already there")).toBeVisible();
});

test("#1675 opening the list writes the cancel-by todos first, then reads the contracts", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  const reminders = async () => {
    await held;
    return { json: [] };
  };
  const { sentTo } = await openPlans(page, { "POST /api/finance/contracts/reminders": reminders });

  await expect.poll(() => sentTo("POST /api/finance/contracts/reminders")).toHaveLength(1);
  // Long enough for a read sent beside the write to show.
  await page.waitForTimeout(500);
  expect(sentTo("GET /api/finance/contracts")).toEqual([]);
  release();

  await expect.poll(() => sentTo("GET /api/finance/contracts")).toHaveLength(1);
});

test("#1675 a proposal with nothing to match offers no Contract until it is a plan", async ({
  page,
}) => {
  const loose = [{ ...PROPOSAL, payee_id: null, text: null }];
  const { finance, sentTo } = await openPlans(page, { "GET /api/finance/plans/proposals": loose });

  const button = finance.getByRole("button", { name: "Make a contract note for Haftpflicht" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute(
    "title",
    "Confirm it as a plan first: it has nothing to match by",
  );
  await button.click({ force: true });
  expect(sentTo("POST").filter((line) => !line.includes("reminders"))).toEqual([]);
});
