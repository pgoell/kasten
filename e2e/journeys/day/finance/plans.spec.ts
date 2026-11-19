import { phone } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { ACCOUNT, onPhone, openPlans, PLAN, PROPOSAL, WEDDING } from "./finance.ts";

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

/** Wedding's goal answer, assigned for the month once its assign has been sent. */
function assigning() {
  let assigned = false;
  const goals = async () => ({
    json: {
      goals: [
        assigned ? { ...WEDDING, assigned_month: "2026-10", assigned_amount: "500.00" } : WEDDING,
      ],
      accounts: [ACCOUNT],
    },
  });
  const assign = async () => {
    assigned = true;
    return { status: 204 };
  };
  return { "GET /api/finance/goals": goals, "POST /api/finance/goals/7/assign": assign };
}

const ASSIGN = "POST /api/finance/goals/7/assign?today=2026-10-25";
const UNDO = "DELETE /api/finance/goals/7/assign?today=2026-10-25";

test("#1037 a proposal is confirmed with its key, as it was proposed", async ({ page }) => {
  const { finance, sentTo } = await openPlans(page);
  await expect(finance.getByText("Haftpflicht")).toBeVisible();
  await expect(finance.getByText(/Yearly, a Firefly bill, seen once/)).toBeVisible();

  await page.keyboard.press("1");

  await expect.poll(() => sentTo("POST /api/finance/plans")).toHaveLength(1);
  const [sent] = sentTo("POST /api/finance/plans");
  const start = "POST /api/finance/plans?today=2026-10-25 ";
  expect(sent.startsWith(start)).toBe(true);
  expect(JSON.parse(sent.slice(start.length))).toEqual(PLAN);
});

test("#1037 a date a booking met has its tick, and a goal says its month", async ({ page }) => {
  const { finance } = await openPlans(page);

  await expect(finance.getByRole("img", { name: "met" })).toBeVisible();
  await expect(finance.getByText(/met 30 Sept?, early, −950,00/)).toBeVisible();
  await expect(finance.getByText("500 € moved this month ✓")).toBeVisible();
  await expect(finance.getByText(/needs 750\s€ a month/)).toBeVisible();
  await expect(finance.getByText("16.800 € of 21.300 €")).toBeVisible();
  await expect(finance.getByText("Not reserved on DKB Personal Saving")).toBeVisible();
  await expect(finance.getByText(/Left from limits: 120,00/)).toBeVisible();
});

test("#1037 a assigns the month's contribution once, and u takes it back", async ({ page }) => {
  const { finance, sentTo } = await openPlans(page, assigning());
  await expect(finance.getByText("Wedding")).toBeVisible();

  await page.keyboard.press("a");
  await expect(finance.getByText("500 € assigned ✓")).toBeVisible();
  await page.keyboard.press("a");
  await page.keyboard.press("u");

  await expect.poll(() => sentTo("DELETE")).toEqual([UNDO]);
  expect(sentTo("POST /api/finance/goals")).toEqual([ASSIGN]);
});

for (const [kind, use] of [
  ["click", {}],
  ["tap on a phone", phone],
] as const) {
  test.describe(kind, () => {
    test.use(use);
    test(`#1766 the goal's Assign and Undo buttons write as its keys do, by ${kind}`, async ({
      page,
    }) => {
      const { finance, sentTo } = await openPlans(page, assigning());

      const press = (name: string | RegExp) => {
        const button = finance.getByRole("button", { name });
        return onPhone(page) ? button.tap() : button.click();
      };

      await press(/^Assign .* to Wedding$/);
      await expect.poll(() => sentTo("POST /api/finance/goals")).toEqual([ASSIGN]);
      await press("Undo assigning to Wedding");

      await expect.poll(() => sentTo("DELETE")).toEqual([UNDO]);
    });
  });
}

test("#1037 a proposal with nothing to match opens the form, whose keys rest", async ({ page }) => {
  const loose = [{ ...PROPOSAL, payee_id: null, text: null }];
  const { finance, sentTo } = await openPlans(page, { "GET /api/finance/plans/proposals": loose });
  await expect(finance.getByText("Haftpflicht")).toBeVisible();

  await page.keyboard.press("1");
  const name = finance.getByRole("textbox", { name: "Name" });
  await expect(name).toBeVisible();
  // With the form open a goal key does nothing.
  await finance.focus();
  await page.keyboard.press("a");
  await page.keyboard.press("Escape");

  await expect(name).toHaveCount(0);
  expect(sentTo("POST")).toEqual(["POST /api/finance/contracts/reminders?today=2026-10-25"]);
});

test("#1037 an assign that cannot happen says why", async ({ page }) => {
  const short = { goals: [WEDDING], accounts: [{ ...ACCOUNT, unreserved: "100.00" }] };
  const { finance } = await openPlans(page, { "GET /api/finance/goals": short });

  await expect(finance.getByText(/only 100\s€ not reserved on DKB Personal Saving/)).toBeVisible();
});
