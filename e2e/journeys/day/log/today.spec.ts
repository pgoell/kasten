import type { Locator, Page } from "@playwright/test";
import { leader, openApp, phone, plus, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { DAY, daily, lines, logPane, note, PAST, selected, TODAY } from "./log.ts";

const LUNCH = "- 🍽 lunch: oats 🔥 300 kcal 🥩 10 g 🍞 50 g 🧈 5 g";

/** The Today row whose name is exactly `name`. */
const row = (pane: Locator, name: string) =>
  pane
    .getByRole("region", { name: "Today" })
    .locator(".log-pane-reading")
    .filter({ has: pane.page().locator(".log-pane-name", { hasText: new RegExp(`^${name}$`) }) });

const sheetOf = (page: Page) => page.getByRole("dialog", { name: "Food search" });

/** Picks the recent oats in the open sheet as lunch and presses Log this food. */
async function logOats(page: Page) {
  const sheet = sheetOf(page);
  await sheet.getByRole("button", { name: /oats.*recent/ }).click();
  await sheet.getByLabel("Meal", { exact: true }).selectOption("lunch");
  await sheet.getByRole("button", { name: "Log this food" }).click();
}

/** The computed colour of the goal words in a Today row. */
const goalColour = (pane: Locator, name: string) =>
  row(pane, name)
    .locator(".log-pane-goal")
    .evaluate((goal) => getComputedStyle(goal).color);

test("#804 each kind, kcal and macro row shows its total, goal in words and meter, and the quick buttons carry theirs", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  const meter = (name: string) => row(pane, name).getByRole("meter");
  await expect(row(pane, "Water")).toContainText("500 ml");
  await expect(row(pane, "Water")).toContainText("at least 2,000");
  await expect(meter("Water")).toHaveAttribute("aria-label", "water");
  await expect(meter("Water")).toHaveAttribute("aria-valuenow", "500");
  await expect(meter("Water")).toHaveAttribute("aria-valuemax", "2000");
  await expect(row(pane, "Coffee")).toContainText("2");
  await expect(row(pane, "Coffee")).toContainText("at most 3, within");
  await expect(row(pane, "Juice")).toContainText("200 ml");
  await expect(row(pane, "Juice")).toContainText("at most 500, within");
  await expect(row(pane, "Alcohol")).toContainText("0");
  await expect(meter("Alcohol")).toHaveCount(0);
  await expect(row(pane, "Kcal")).toContainText("380 kcal");
  await expect(row(pane, "Kcal")).toContainText("at most 2,000, within");
  await expect(meter("Kcal")).toHaveAttribute("aria-valuenow", "380");
  await expect(row(pane, "Protein")).toContainText("10 g");
  await expect(row(pane, "Protein")).toContainText("at least 100");
  await expect(meter("Protein")).toHaveAttribute("aria-valuemax", "100");
  await expect(row(pane, "Carbs")).toContainText("50 g");
  await expect(meter("Carbs")).toHaveCount(0);

  const water = pane.getByRole("button", { name: "Log water" });
  await expect(water).toHaveClass(/\bcm-log-button\b/);
  await expect(water.getByRole("meter")).toHaveCount(1);
  await expect(pane.getByRole("button", { name: "Log food" })).toHaveText("+ Food");
});

test("#804 the weight row is an empty slot with a dash and no number", async ({ page, stack }) => {
  const pane = await logPane(page, stack.vault);
  const slot = pane.getByRole("region", { name: "Today" }).locator("[data-slot='weight']");
  await expect(slot).toContainText("Weight");
  await expect(slot).toContainText("—");
  await expect(slot).toContainText("no weigh-ins yet");
  await expect(slot.getByRole("meter")).toHaveCount(0);
  await expect(slot).not.toHaveText(/\d/);
});

test("#804 the day picker sits above the column, Day before and h go back and t comes to today", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  const field = pane.getByLabel("Day", { exact: true });
  const picker = await field.boundingBox();
  const column = await pane.getByRole("region", { name: "Today" }).boundingBox();
  expect(picker && column && picker.y + picker.height <= column.y).toBe(true);
  await pane.getByRole("button", { name: "Day before" }).click();
  await expect(pane.getByRole("heading", { level: 2, name: PAST })).toBeVisible();
  await expect(field).toHaveValue(PAST);
  await pane.focus();
  await page.keyboard.press("t");
  await expect(pane.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
  await page.keyboard.press("h");
  await expect(field).toHaveValue(PAST);
});

test("#804 + Food opens the food search as the right panel with a scrim over the pane", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.getByRole("button", { name: "Log food" }).click();
  const sheet = pane.getByRole("dialog", { name: "Food search" });
  await expect(sheet).toBeVisible();
  const scrim = sheet.locator("xpath=preceding-sibling::*[1]");
  await expect(scrim).toHaveCSS("background-color", /^(rgba|oklab)\(0,? 0,? 0,? \/? ?0\.3\)$/);
  const area = await pane.boundingBox();
  expect(await scrim.boundingBox()).toEqual(area);
  // The panel slides in from the right, so its place is read once it has come to rest.
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box && [Math.round(box.x + box.width), Math.round(box.width)];
    })
    .toEqual([area && Math.round(area.x + area.width), 540]);
});

test("#804 a quick tap, an amount and a food pick write their lines byte for byte, and the log reads them back", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.getByRole("button", { name: "Log water" }).click();
  await expect.poll(() => lines(stack.vault)).toEqual([...DAY, "- 💧 250 ml"]);
  await pane.getByLabel("Amount").fill("330");
  await pane.getByRole("button", { name: "Log water" }).click();
  await pane.getByRole("button", { name: "Log food" }).click();
  await logOats(page);
  await expect
    .poll(() => lines(stack.vault))
    .toEqual([...DAY, "- 💧 250 ml", "- 💧 330 ml", LUNCH]);
  await expect(row(pane, "Water").getByRole("meter")).toHaveAttribute("aria-valuenow", "1080");
  await expect(row(pane, "Kcal")).toContainText("680 kcal");
  await expect(
    pane.getByRole("region", { name: "Today" }).getByRole("heading", { level: 3 }),
  ).toHaveText(["Breakfast", "Lunch", "No meal"]);
});

test("#804 Escape in the food field gives the pane the focus and j moves the cursor at once", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.focus();
  await page.keyboard.press("f");
  await sheetOf(page).getByRole("textbox", { name: "Food" }).press("Escape");
  await expect(pane).toBeFocused();
  await page.keyboard.press("j");
  await expect(selected(page)).toContainText("☕ 2");
});

test("#804 a quick button pressed by Enter keeps the focus and the pane keys still work", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.getByLabel("Amount").fill("330");
  const water = pane.getByRole("button", { name: "Log water" });
  await water.focus();
  await page.keyboard.press("Enter");
  await expect(pane.getByRole("button", { name: "💧 330 ml" })).toBeVisible();
  expect(await lines(stack.vault)).toEqual([...DAY, "- 💧 330 ml"]);
  await expect(water).toBeFocused();
  await page.keyboard.press("j");
  await expect(selected(page)).toContainText("☕ 2");
});

test("#804 Escape on the sheet then f opens it again, and so does + Food after a scrim tap", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  const sheet = sheetOf(page);
  await pane.focus();
  await page.keyboard.press("f");
  await expect(sheet).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.keyboard.press("f");
  await expect(sheet).toBeVisible();
  await sheet.locator("xpath=preceding-sibling::*[1]").click({ position: { x: 10, y: 10 } });
  await expect(sheet).toBeHidden();
  await pane.getByRole("button", { name: "Log food" }).click();
  await expect(sheet).toBeVisible();
});

test("#804 on the day after, a refused food log keeps the sheet open and a logged one closes it into that day's note", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.focus();
  await page.keyboard.press("l");
  await expect(pane.getByRole("heading", { level: 2, name: plus(1) })).toBeVisible();
  // The day has no note yet, so the write is a create, not a PUT.
  await page.route("**/api/files/**", (route) =>
    route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 500 }),
  );
  await page.keyboard.press("f");
  await logOats(page);
  await expect(page.getByText(/^Nothing logged:/)).toBeVisible();
  await expect(sheetOf(page)).toBeVisible();
  await page.unroute("**/api/files/**");
  await sheetOf(page).getByRole("button", { name: "Log this food" }).click();
  await expect(sheetOf(page)).toBeHidden();
  await expect.poll(() => lines(stack.vault, plus(1))).toEqual([LUNCH]);
  expect(await lines(stack.vault)).toEqual(DAY);
});

test("#804 the pane closed with the food sheet open leaves no sheet behind", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.focus();
  await page.keyboard.press("f");
  await expect(sheetOf(page)).toBeVisible();
  await page.getByRole("button", { name: "Close Log" }).click();
  await expect(pane).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cm-log-food-host")).toHaveCount(0);
});

test("#804 a passed max says over and a met floor says met in words, each in its own colour", async ({
  page,
  stack,
}) => {
  const day = ["- 💧 500 ml", "- ☕ 4", "- 🍽 steak 🔥 500 kcal 🥩 120 g"];
  const pane = await logPane(page, stack.vault, "leader", day);
  await expect(row(pane, "Coffee")).toContainText("at most 3, over");
  await expect(row(pane, "Protein")).toContainText("at least 100, met");
  const [over, met, plain] = await Promise.all(
    ["Coffee", "Protein", "Water"].map((name) => goalColour(pane, name)),
  );
  expect(new Set([over, met, plain]).size).toBe(3);
});

test("#804 a failed day read shows its message in the Today column and the quick buttons still write", async ({
  page,
  stack,
}) => {
  await page.route("**/api/log?*", (route) => {
    const asked = new URL(route.request().url()).searchParams;
    return asked.get("from") === asked.get("to")
      ? route.fulfill({ status: 500, body: "{}" })
      : route.fallback();
  });
  await vaultWith(stack.vault, { [daily(TODAY)]: note(["- ☕ 2"]) });
  await openApp(page);
  await leader(page, "gf");
  const pane = page.getByRole("region", { name: "Log" });
  await expect(pane.getByRole("region", { name: "Today" }).getByRole("alert").first()).toHaveText(
    "GET /api/log failed with 500",
    { timeout: 15_000 },
  );
  await pane.getByRole("button", { name: "Log water" }).click();
  await expect.poll(() => lines(stack.vault)).toEqual(["- ☕ 2", "- 💧 250 ml"]);
});

test("#804 on a desktop Today and Trends show side by side with no tabs", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await expect(pane.getByRole("tablist")).toHaveCount(0);
  const [today, trends] = await Promise.all(
    ["Today", "Trends"].map((name) => pane.getByRole("region", { name }).boundingBox()),
  );
  expect(today && trends && today.y === trends.y && trends.x >= today.x + today.width).toBe(true);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#804 + Food opens the food search as the bottom sheet with a grabber and one food panel", async ({
    page,
    stack,
  }) => {
    const pane = await logPane(page, stack.vault, "phone");
    await pane.getByRole("button", { name: "Log food" }).tap();
    const sheet = sheetOf(page);
    await expect(sheet.getByRole("textbox", { name: "Food" })).toBeVisible();
    // The sheet slides up, so its place is read once it has come to rest.
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();
        return box && [box.x, box.width, Math.round(box.y + box.height)];
      })
      .toEqual([0, 414, 896]);
    await expect(sheet.locator("[data-sheet-drag]").first()).toBeVisible();
    await expect(page.locator(".cm-log-food")).toHaveCount(1);
    await expect(sheet.locator(".cm-log-food")).toHaveCount(1);
  });

  test("#804 Today and Trends are two tabs and a tap shows the other column", async ({
    page,
    stack,
  }) => {
    const pane = await logPane(page, stack.vault, "phone");
    const tab = (name: string) => pane.getByRole("tablist").getByRole("tab", { name });
    await expect(tab("Today")).toHaveAttribute("aria-selected", "true");
    await expect(tab("Trends")).toHaveAttribute("aria-selected", "false");
    await expect(pane.getByRole("region", { name: "Today" })).toBeVisible();
    await expect(pane.getByRole("region", { name: "Trends" })).toHaveCount(0);
    await tab("Trends").tap();
    await expect(pane.getByRole("region", { name: "Trends" })).toBeVisible();
    await expect(pane.getByRole("region", { name: "Today" })).toHaveCount(0);
  });

  test("#804 switching tabs keeps the day and the cursor, and j still moves it", async ({
    page,
    stack,
  }) => {
    const pane = await logPane(page, stack.vault, "phone");
    const tab = (name: string) => pane.getByRole("tablist").getByRole("tab", { name });
    await pane.focus();
    await page.keyboard.press("j");
    await expect(selected(page)).toContainText("☕ 2");
    await tab("Trends").tap();
    await expect(pane.getByLabel("Day", { exact: true })).toHaveValue(TODAY);
    await page.keyboard.press("j");
    await expect(selected(page)).toContainText("🥤 200 ml");
    await tab("Today").tap();
    await expect(pane.getByLabel("Day", { exact: true })).toHaveValue(TODAY);
    await expect(selected(page)).toContainText("🥤 200 ml");
  });
});
