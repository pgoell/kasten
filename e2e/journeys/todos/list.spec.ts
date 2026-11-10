import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cursorTo, leader, noteText, openApp, phone } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

// A todo row is keyed by its line, "Home.md:12"; the file tree's rows are not.
const TODO_ROW = '[data-row*=".md:"]';
const HOME_TODOS = [
  "empty the dishwasher",
  "fold the laundry",
  "take out the bins",
  "water the plants",
  "ask the landlord about the boiler",
];

const HOME = "02 Projects/Home.md";

test("checking off a todo in the todo pane changes the note's line", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
  // The first row starts under the cursor; X sets it done.
  await page.keyboard.press("X");
  await expect
    .poll(() => noteText(stack.vault, "02 Projects/Garden.md"), { timeout: 15_000 })
    .toMatch(/^- \[x\] water the tomatoes/m);
});

test("clicking a todo opens its note on the todo's line", async ({ page }) => {
  await openApp(page);
  await leader(page, "gt");
  await page.getByRole("button", { name: "open reply to the far away letter" }).click();
  const line = page.locator(".cm-line", { hasText: "reply to the far away letter" });
  await expect(line).toBeInViewport();
  await expect(page.locator(".cm-activeLine")).toContainText("reply to the far away letter");
});

test("checking off three todos in a row keeps the rows in their order", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "gt");
  // A checked row stays put, struck through (#947), so each row is found again by its words.
  for (const name of HOME_TODOS.slice(0, 3)) {
    await cursorTo(page, name);
    await page.keyboard.press("X");
    // The list redraws once the write lands, so wait for the line before the next row is found.
    await expect
      .poll(() => noteText(stack.vault, HOME), { timeout: 15_000 })
      .toMatch(new RegExp(`^- \\[x\\] ${name}`, "m"));
  }
  const texts = await page
    .locator(TODO_ROW)
    .evaluateAll((rows) => rows.map((row) => row.textContent ?? ""));
  const order = texts
    .map((text) => HOME_TODOS.find((name) => text.includes(name)))
    .filter((name) => name !== undefined);
  expect(order).toEqual(HOME_TODOS);
  await expect
    .poll(() => noteText(stack.vault, HOME), { timeout: 15_000 })
    .toMatch(
      /^- \[x\] empty the dishwasher.*\n- \[x\] fold the laundry.*\n- \[x\] take out the bins/m,
    );
});

test("marking a recurring todo done writes its next copy above it", async ({ page, stack }) => {
  // The next copy counts off the due date. The fixture has none: a dated todo would head the list.
  const note = join(stack.vault, HOME);
  const fixture = await readFile(note, "utf8");
  await writeFile(note, fixture.replace("plants 🔁", "plants 📅 2026-11-10 🔁"));
  await openApp(page);
  await leader(page, "gt");
  await cursorTo(page, "water the plants");
  await page.keyboard.press("X");
  await expect
    .poll(() => noteText(stack.vault, HOME), { timeout: 15_000 })
    .toMatch(
      /^- \[ \] water the plants 📅 2026-11-17 🔁 every week\n- \[x\] water the plants 📅 2026-11-10 🔁 every week ✅/m,
    );
});

test("setting a todo to waiting marks its line and its row", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "gt");
  await cursorTo(page, "ask the landlord about the boiler");
  await page.keyboard.press("W");
  await expect
    .poll(() => noteText(stack.vault, HOME), { timeout: 15_000 })
    .toMatch(/^- \[w\] ask the landlord about the boiler/m);
  const row = page.locator(TODO_ROW, { hasText: "ask the landlord about the boiler" });
  await expect(row.getByRole("img", { name: "waiting" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("tapping a todo's more strip and done checks its line off", async ({ page, stack }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap();
    await page.getByRole("button", { name: "more for fold the laundry" }).tap();
    await page.getByRole("button", { name: "done fold the laundry" }).tap();
    await expect
      .poll(() => noteText(stack.vault, HOME), { timeout: 15_000 })
      .toMatch(/^- \[x\] fold the laundry/m);
  });
});
