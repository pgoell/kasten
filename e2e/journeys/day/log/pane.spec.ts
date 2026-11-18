import type { Page } from "@playwright/test";
import {
  bodyOf,
  findNote,
  leader,
  noteText,
  openApp,
  phone,
  plus,
  today,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const CONFIG_PATH = "99 Misc/01 Config/log.md";
const CONFIG = `- 💧 water: 250 ml, min 2000
- ☕ coffee: 1, max 3
- 🍺 alcohol: 1
- 🥤 juice: 200 ml, max 500
- 🍽 food: kcal max 2000, protein min 100
`;
const OATS = "- 🍽 breakfast: oats 🔥 300 kcal 🥩 10 g 🍞 50 g 🧈 5 g";
/** Today's log: two drinks, a kind of your own, and food under a meal and under none. */
const DAY = ["- 💧 500 ml", "- ☕ 2", "- 🥤 200 ml", OATS, "- 🍽 apple 🔥 80 kcal"];
const TODAY = today();
const PAST = plus(-1);
const daily = (date: string) => `01 Periodic/00 Daily/${date}.md`;
// Stamped as kasten writes a note: a first save stamps a bare one, which moves its lines and fails an undo (#2173).
const STAMP =
  "---\nid: 1\ncreated: 2026-11-01T00:00:00+00:00\ntype: note\nmodified: 2026-11-01T00:00:00+00:00\n---\n";
const note = (lines: string[]) => `${STAMP}# Day\n\n## Log\n${lines.join("\n")}\n`;

/** The log lines in a day's note on disk. */
const lines = async (vault: string, date = TODAY) =>
  bodyOf(await noteText(vault, daily(date)))
    .split("\n")
    .filter((line) => line.startsWith("- "));

/** Writes the config, today's log and a litre of water yesterday, and opens the log pane. */
async function logPane(page: Page, vault: string, how: "leader" | "palette" | "phone" = "leader") {
  await vaultWith(vault, {
    [CONFIG_PATH]: CONFIG,
    [daily(TODAY)]: note(DAY),
    [daily(PAST)]: note(["- 💧 1 l"]),
  });
  if (how === "phone") {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await commands.getByRole("button", { name: "Run a command by name" }).tap({ timeout: 15_000 });
    await page.getByRole("option", { name: /^Open the log/ }).tap();
  } else {
    if (how === "palette") {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    }
    await openApp(page);
    if (how === "leader") await leader(page, "gf");
    else {
      await page.keyboard.press("Control+Shift+P");
      await page.getByRole("option", { name: /^Open the log/ }).click();
    }
  }
  const pane = page.getByRole("region", { name: "Log" });
  await expect(pane.getByRole("button", { name: "💧 500 ml" })).toBeVisible({ timeout: 15_000 });
  return pane;
}

/** Each GET /api/log the page sends, as `from..to`. */
function logReads(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/log") {
      asked.push(`${url.searchParams.get("from")}..${url.searchParams.get("to")}`);
    }
  });
  return asked;
}

const selected = (page: Page) => page.locator('li[aria-selected="true"]');
const editForm = (page: Page) => page.locator(".log-pane-edit");

test("#624 Today shows each kind against its goal and the food day grouped by meal", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  const day = pane.getByRole("region", { name: "Today" });
  for (const words of [
    "500 ml",
    "at least 2,000",
    "at most 3, within",
    "200 ml",
    "at most 500, within",
    "380 kcal",
    "at most 2,000, within",
    "10 g",
    "at least 100",
  ]) {
    await expect(day.getByText(words, { exact: true }).first(), words).toBeVisible();
  }
  const water = day.getByRole("meter", { name: "water" }).first();
  await expect(water).toHaveAttribute("aria-valuenow", "500");
  await expect(water).toHaveAttribute("aria-valuemax", "2000");
  await expect(day.getByRole("meter", { name: "juice" }).first()).toHaveAttribute(
    "aria-valuenow",
    "200",
  );
  await expect(day.getByRole("heading", { level: 3 })).toHaveText(["Breakfast", "No meal"]);
});

test("#624 a kind button and the amount field write the kind's line into today's note", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  const amount = pane.getByLabel("Amount");
  await pane.getByRole("button", { name: "Log water" }).click();
  await expect.poll(() => lines(stack.vault)).toEqual([...DAY, "- 💧 250 ml"]);
  await amount.fill("500");
  await pane.getByRole("button", { name: "Log water" }).click();
  await expect.poll(() => lines(stack.vault)).toContain("- 💧 500 ml");
  await expect(amount).toHaveValue("");
  await amount.fill("300");
  await pane.getByRole("button", { name: "Log juice" }).click();
  await expect
    .poll(() => lines(stack.vault))
    .toEqual([...DAY, "- 💧 250 ml", "- 💧 500 ml", "- 🥤 300 ml"]);
});

test("#624 h and the day buttons move the day, and a log on a past day writes that day's note", async ({
  page,
  stack,
}) => {
  const asked = logReads(page);
  const pane = await logPane(page, stack.vault);
  await page.keyboard.press("h");
  await expect(pane.getByRole("heading", { level: 2, name: PAST })).toBeVisible();
  expect(asked).toContain(`${PAST}..${PAST}`);
  await pane.getByRole("button", { name: "Log coffee" }).click();
  await expect.poll(() => lines(stack.vault, PAST)).toEqual(["- 💧 1 l", "- ☕ 1"]);
  expect(await lines(stack.vault)).toEqual(DAY);

  await pane.getByRole("button", { name: "Day after" }).click();
  await expect(pane.getByLabel("Day", { exact: true })).toHaveValue(TODAY);
  await pane.getByLabel("Day", { exact: true }).fill(PAST);
  await expect(pane.getByRole("heading", { level: 2, name: PAST })).toBeVisible();
  await pane.getByRole("button", { name: "Today", exact: true }).click();
  await expect(pane.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
});

test("#624 a tap or e edits a row's amount, a kind of your own too, and Save writes the line", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.getByRole("button", { name: "💧 500 ml" }).click();
  await editForm(page).getByLabel("Amount").fill("750");
  await editForm(page).getByRole("button", { name: "Save" }).click();
  await expect(editForm(page)).toHaveCount(0);
  await expect.poll(() => lines(stack.vault)).toEqual(["- 💧 750 ml", ...DAY.slice(1)]);

  await pane.focus();
  for (const key of ["j", "j", "e"]) await page.keyboard.press(key);
  await expect(editForm(page).getByLabel("Amount")).toHaveValue("200 ml");
  await editForm(page).getByLabel("Amount").fill("250 ml");
  await editForm(page).getByRole("button", { name: "Save" }).click();
  await expect.poll(() => lines(stack.vault)).toContain("- 🥤 250 ml");
  expect(await lines(stack.vault)).not.toContain("- 🥤 200 ml");
});

test("#624 a food row's edit sets meal and servings", async ({ page, stack }) => {
  const pane = await logPane(page, stack.vault);
  await pane.focus();
  for (const key of ["j", "j", "j", "e"]) await page.keyboard.press(key);
  const form = editForm(page);
  await expect(form.getByLabel("Meal")).toHaveValue("breakfast");
  await expect(form.getByLabel("Servings")).toHaveValue("1");
  await form.getByLabel("Meal").selectOption("dinner");
  await form.getByLabel("Servings").fill("2");
  await form.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => lines(stack.vault))
    .toEqual([...DAY.slice(0, 3), "- 🍽 dinner: oats 🔥 600 kcal 🥩 20 g 🍞 100 g 🧈 10 g", DAY[4]]);
});

test("#624 d deletes the row under the cursor and Undo puts it back", async ({ page, stack }) => {
  const pane = await logPane(page, stack.vault);
  await pane.focus();
  await page.keyboard.press("d");
  await expect.poll(() => lines(stack.vault)).toEqual(DAY.slice(1));
  await pane.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => lines(stack.vault)).toEqual(DAY);
});

test("#624 o opens the day's note at the entry's line", async ({ page, stack }) => {
  const pane = await logPane(page, stack.vault);
  await pane.focus();
  await page.keyboard.press("j");
  await page.keyboard.press("o");
  await expect(page.getByRole("tab", { name: TODAY, selected: true })).toBeVisible();
  await expect(page.locator(".cm-activeLine:visible")).toContainText("☕ 2");
});

for (const how of ["leader", "palette"] as const) {
  test(`#624 j and k move the cursor and keys typed in the amount field are not pane keys, vim ${how === "leader" ? "on" : "off"}`, async ({
    page,
    stack,
  }) => {
    const pane = await logPane(page, stack.vault, how);
    await pane.focus();
    await page.keyboard.press("j");
    await expect(selected(page)).toContainText("☕ 2");
    await page.keyboard.press("k");
    await expect(selected(page)).toContainText("💧 500 ml");

    await pane.getByLabel("Amount").press("j");
    await pane.getByLabel("Amount").press("d");
    await expect(pane.getByLabel("Amount")).toHaveValue("jd");
    await expect(selected(page)).toContainText("💧 500 ml");
    await pane.getByLabel("Amount").fill("");
    // A write after the presses: had `d` deleted the row, the note would lack it now.
    await pane.getByRole("button", { name: "Log coffee" }).click();
    await expect.poll(() => lines(stack.vault)).toEqual([...DAY, "- ☕ 1"]);
  });
}

test("#624 Escape leaves the edit without writing", async ({ page, stack }) => {
  const pane = await logPane(page, stack.vault);
  await pane.getByRole("button", { name: "💧 500 ml" }).click();
  await editForm(page).getByLabel("Amount").fill("750");
  await editForm(page).getByLabel("Amount").press("Escape");
  await expect(editForm(page)).toHaveCount(0);
  await pane.getByRole("button", { name: "Log coffee" }).click();
  await expect.poll(() => lines(stack.vault)).toEqual([...DAY, "- ☕ 1"]);
});

test("#624 Trends draws a bar per logged day and the goal as a line over 7, 30 and 90 days, and leaves a day with no log out of the average", async ({
  page,
  stack,
}) => {
  const asked = logReads(page);
  const pane = await logPane(page, stack.vault);
  const trends = pane.getByRole("region", { name: "Trends" });
  const month = trends.getByRole("img", { name: "water over 30 days" });
  await expect(month.locator("rect")).toHaveCount(2);
  await expect(month.locator('line[data-goal="2000"]')).toHaveCount(1);
  await expect(trends.getByRole("img", { name: "juice over 30 days" })).toBeVisible();

  await pane.focus();
  await page.keyboard.press("7");
  const week = trends.getByRole("img", { name: "water over 7 days" });
  await expect(week.locator("rect")).toHaveCount(2);
  expect(asked).toContain(`${plus(-6)}..${TODAY}`);
  // Five of the 7 days have no note: the average is of the two logged days.
  await expect(trends.getByText(/average 750 ml over 2 logged days/)).toBeVisible();

  await page.keyboard.press("9");
  await expect(trends.getByRole("img", { name: "water over 90 days" })).toBeVisible();
});

test("#624 a failed log read shows its message and a kind button still writes", async ({
  page,
  stack,
}) => {
  await page.route("**/api/log?*", (route) => route.fulfill({ status: 500, body: "{}" }));
  await vaultWith(stack.vault, { [daily(TODAY)]: note(DAY) });
  await openApp(page);
  await leader(page, "gf");
  const pane = page.getByRole("region", { name: "Log" });
  await expect(pane.getByRole("alert").first()).toHaveText("GET /api/log failed with 500", {
    timeout: 15_000,
  });
  await pane.getByRole("button", { name: "Log water" }).click();
  await expect.poll(() => lines(stack.vault)).toEqual([...DAY, "- 💧 250 ml"]);
});

test("#624 the food search opens from the pane on f and logs into the day shown", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.focus();
  await page.keyboard.press("f");
  const sheet = page.getByRole("dialog", { name: "Food search" });
  // The shared sheet, which takes the focus on its dialog, as the card's does.
  await expect(sheet).toBeFocused();
  await expect(sheet.getByRole("textbox", { name: "Food" })).toBeVisible();
  await sheet.getByRole("button", { name: /oats.*recent/ }).click();
  await sheet.getByLabel("Meal", { exact: true }).selectOption("lunch");
  await sheet.getByRole("button", { name: "Log this food" }).click();
  await expect(sheet).toBeHidden();
  await expect
    .poll(() => lines(stack.vault))
    .toEqual([...DAY, "- 🍽 lunch: oats 🔥 300 kcal 🥩 10 g 🍞 50 g 🧈 5 g"]);
});

test("#624 a refused food log keeps the food search open", async ({ page, stack }) => {
  const pane = await logPane(page, stack.vault);
  await page.route("**/api/files/**", (route) =>
    route.request().method() === "PUT" ? route.fulfill({ status: 500 }) : route.fallback(),
  );
  await pane.focus();
  await page.keyboard.press("f");
  const sheet = page.getByRole("dialog", { name: "Food search" });
  await sheet.getByRole("button", { name: /oats.*recent/ }).click();
  await sheet.getByLabel("Meal", { exact: true }).selectOption("breakfast");
  await sheet.getByRole("button", { name: "Log this food" }).click();
  await expect(page.getByText(/^Nothing logged/)).toBeVisible();
  expect(await lines(stack.vault)).toEqual(DAY);
  // A closing sheet still draws its button while it slides out, so the proof is a second try that lands.
  await page.unroute("**/api/files/**");
  await sheet.getByRole("button", { name: "Log this food" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => lines(stack.vault)).toEqual([...DAY, OATS]);
});

test("#624 log.md open in an editor beside the pane keeps its text, and the pane reads its kinds", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { [CONFIG_PATH]: `${CONFIG}- 🍵 tea: 150 ml\n` });
  await openApp(page);
  await findNote(page, "log");
  await leader(page, "%");
  await leader(page, "gf");
  await expect(
    page.getByRole("region", { name: "Log" }).getByRole("button", { name: "Log tea" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cm-content:visible").first()).toContainText("tea: 150 ml");
});

test("#624 Enter on a focused row button edits that row, not the cursor row", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.focus();
  await page.keyboard.press("j");
  await pane.getByRole("button", { name: "🥤 200 ml" }).focus();
  await page.keyboard.press("Enter");
  await expect(editForm(page).getByLabel("Amount")).toHaveValue("200 ml");
});

test("#968 keys pressed in an open edit or inside the food sheet are not pane keys", async ({
  page,
  stack,
}) => {
  const pane = await logPane(page, stack.vault);
  await pane.focus();
  await page.keyboard.press("e");
  await editForm(page).getByRole("button", { name: "Save" }).focus();
  await page.keyboard.press("d");
  await editForm(page).getByLabel("Amount").press("Escape");
  await expect(editForm(page)).toHaveCount(0);

  await page.keyboard.press("f");
  const sheet = page.getByRole("dialog", { name: "Food search" });
  await expect(sheet).toBeFocused();
  await sheet.getByRole("button", { name: "Scan a barcode" }).focus();
  await page.keyboard.press("j");
  await page.keyboard.press("d");
  await expect(selected(page)).toContainText("💧 500 ml");
  await sheet.getByRole("textbox", { name: "Food" }).press("Escape");
  await expect(sheet).toBeHidden();
  await pane.getByRole("button", { name: "Log coffee" }).click();
  await expect.poll(() => lines(stack.vault)).toEqual([...DAY, "- ☕ 1"]);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#624 a kind tapped and a row tapped and saved land in today's note", async ({
    page,
    stack,
  }) => {
    const pane = await logPane(page, stack.vault, "phone");
    await pane.getByRole("button", { name: "Log water" }).tap();
    await expect.poll(() => lines(stack.vault)).toEqual([...DAY, "- 💧 250 ml"]);
    await pane.getByRole("button", { name: "☕ 2" }).tap();
    await editForm(page).getByLabel("Amount").fill("3");
    await editForm(page).getByRole("button", { name: "Save" }).tap();
    await expect
      .poll(() => lines(stack.vault))
      .toEqual([DAY[0], "- ☕ 3", ...DAY.slice(2), "- 💧 250 ml"]);
  });
});
