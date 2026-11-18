import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  bodyOf,
  cursorTo,
  leader,
  noteText,
  openApp,
  plus,
  TODO_ROW,
  today,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const NOTE = "02 Projects/Dentist.md";
// Overdue and important, so neither a due date nor a priority is a hint.
const LINE = "- [ ] call the dentist 📅 2026-01-07 ⏫ #health";
const NEXT = "- [ ] book the checkup 📅 2026-01-08";
const draft = (page: Page) => page.getByLabel("edit line");
const hints = (page: Page) => page.getByTestId("todo-hint");
const cursorRow = (page: Page) => page.locator(`${TODO_ROW}[tabindex="0"]`);
const disk = async (vault: string) => bodyOf(await noteText(vault, NOTE));
const note = (...lines: string[]) => `# Dentist\n\n${lines.join("\n")}\n`;

/** The todo pane, its cursor on the dentist's row. */
async function onDentist(page: Page, vault: string, vim = "on") {
  await vaultWith(vault, { [NOTE]: note(LINE, NEXT) });
  await openApp(page);
  if (vim === "on") await leader(page, "gt");
  else {
    // Space is a letter with vim off, so the palette opens the pane.
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
  }
  await expect(page.locator(TODO_ROW, { hasText: "book the checkup" })).toBeVisible();
  await cursorTo(page, "call the dentist");
}

/** Escape, then x on the dentist's row: one walk on disk proves no key before it walked the row. */
async function walkOnce(page: Page, vault: string) {
  await draft(page).focus();
  await page.keyboard.press("Escape");
  await expect(draft(page)).toHaveCount(0);
  await page.keyboard.press("x");
  await expect.poll(() => disk(vault)).toBe(note(LINE.replace("[ ]", "[/]"), NEXT));
}

test("i turns the row under the cursor into its line as the vault holds it, keys in it", async ({
  page,
  stack,
}) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await expect(draft(page)).toHaveValue(LINE);
  await expect(draft(page)).toBeFocused();
});

test("Enter writes the edited line into the note and draws a row again", async ({ page, stack }) => {
  const edited = "- [/] call the dentist at nine 📅 2026-01-07 ⏫ #health";
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await draft(page).fill(edited);
  await page.keyboard.press("Enter");
  await expect.poll(() => disk(stack.vault)).toBe(note(edited, NEXT));
  await expect(draft(page)).toHaveCount(0);
  await expect(page.locator(TODO_ROW, { hasText: "call the dentist at nine" })).toBeVisible();
});

test("Escape writes nothing and gives the keys back to the list: j moves, x walks that row", async ({
  page,
  stack,
}) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await draft(page).fill("- [ ] something else entirely");
  await page.keyboard.press("Escape");
  await expect(draft(page)).toHaveCount(0);
  await expect(cursorRow(page)).toBeFocused();
  await page.keyboard.press("j");
  await expect(cursorRow(page)).toContainText("book the checkup");
  await page.keyboard.press("x");
  await expect.poll(() => disk(stack.vault)).toBe(note(LINE, NEXT.replace("[ ]", "[/]")));
});

for (const key of ["Escape", "Enter"])
  for (const vim of ["on", "off"])
    test(`#1515 ${key} puts the focus on the row in the commit that drops the edit line, vim ${vim}`, async ({
      page,
      stack,
    }) => {
      if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
      await onDentist(page, stack.vault, vim);
      const row = await cursorRow(page).getAttribute("data-row");
      await page.keyboard.press("i");
      await expect(draft(page)).toBeFocused();
      // Read in the observer pass that first sees the line gone, before any later task can move the focus.
      await page.evaluate(() => {
        const line = document.querySelector('[aria-label="edit line"]');
        const seen = new MutationObserver(() => {
          if (line?.isConnected) return;
          seen.disconnect();
          document.body.dataset.focused = document.activeElement?.getAttribute("data-row") ?? "none";
        });
        seen.observe(document.body, { childList: true, subtree: true });
      });
      await page.keyboard.press(key);
      await expect(page.locator("body")).toHaveAttribute("data-focused", row ?? "");
    });

test("x and a typed into the edit line are letters, not the list's keys", async ({ page, stack }) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await page.keyboard.press("x");
  await page.keyboard.press("a");
  await expect(draft(page)).toHaveValue(`${LINE}xa`);
  await expect(page.getByRole("dialog", { name: "Add todo" })).toHaveCount(0);
  await walkOnce(page, stack.vault);
});

test("the edit line offers the fields the line has not got", async ({ page, stack }) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await expect(hints(page)).toHaveText([
    "⏳ scheduled",
    "🛫 start",
    "🔁 daily",
    "🔁 weekly",
    "🔁 monthly",
    "🔁 repeat",
    "⏲ estimate",
  ]);
});

test("a hint taken writes its field, offers the days it takes next, and gives the keys back to the line", async ({
  page,
  stack,
}) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await hints(page).filter({ hasText: "⏳ scheduled" }).click();
  await expect(draft(page)).toHaveValue(`${LINE} ⏳ `);
  await expect(hints(page).nth(0)).toHaveText(`${today()} today`);
  await expect(hints(page).nth(1)).toHaveText(`${plus(1)} tomorrow`);
  await hints(page).nth(1).click();
  await expect(draft(page)).toHaveValue(`${LINE} ⏳ ${plus(1)}`);
  await expect(draft(page)).toBeFocused();
});

test("x on a hint the Tab key reached is not the list's x", async ({ page, stack }) => {
  await onDentist(page, stack.vault);
  await page.keyboard.press("i");
  await page.keyboard.press("Tab");
  await expect(hints(page).first()).toBeFocused();
  await page.keyboard.press("x");
  await walkOnce(page, stack.vault);
});

test("i with no row in the list opens no edit line and throws nothing", async ({ page, stack }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const plain = "# Plain\n\nno todos here\n";
  await vaultWith(stack.vault, {
    "02 Projects/Home.md": plain,
    "02 Projects/Garden.md": plain,
    "Long note.md": plain,
  });
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByText("nothing to do", { exact: true })).toBeVisible();
  await expect(page.locator(TODO_ROW)).toHaveCount(0);
  await page.keyboard.press("i");
  await page.keyboard.press("x");
  await expect(draft(page)).toHaveCount(0);
  await expect(page.getByTestId("notice")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("#2118 a write the vault's stream opened too late to see still reaches the list once it opens", async ({
  page,
  stack,
}) => {
  // The stream waits until the write has landed, so only a read at its open can show it.
  let open = () => {};
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  await page.route("**/api/events", async (route) => {
    await held;
    await route.continue();
  });
  await onDentist(page, stack.vault);
  await vaultWith(stack.vault, { [NOTE]: note(LINE.replace("call", "ring"), NEXT) });
  await expect(page.locator(TODO_ROW, { hasText: "call the dentist" })).toBeVisible();
  open();
  await expect(page.locator(TODO_ROW, { hasText: "ring the dentist" })).toBeVisible();
});

test("an edit that moves the row under another heading writes the line and keeps the keys in the pane", async ({
  page,
  stack,
}) => {
  const edited = `- [ ] call the dentist ⏳ ${today()} #health`;
  await vaultWith(stack.vault, { [NOTE]: note("- [ ] call the dentist #health", NEXT) });
  await openApp(page);
  await leader(page, "gt");
  await cursorTo(page, "call the dentist");
  await page.keyboard.press("i");
  await draft(page).fill(edited);
  await page.keyboard.press("Enter");
  await expect.poll(() => disk(stack.vault)).toBe(note(edited, NEXT));
  await expect(draft(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Todos" }).locator(":focus")).toHaveCount(1);
});

test("a folder renamed and a note deleted from outside move the board's card to the lane they leave it in", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    "02 Projects/FDE/Kickoff.md": "# Kickoff\n",
    "01 Notes/Deck.md": "# Deck\n\n- [ ] send deck [[Kickoff]]\n",
  });
  await openApp(page);
  await leader(page, "gt");
  await page.keyboard.press("c");
  await page.keyboard.press("g");
  const lane = (name: string) =>
    page.locator("h3:has(button[data-count])", { hasText: new RegExp(`^${name}$`) }).locator("..");
  await expect(lane("FDE")).toContainText("send deck");
  await rename(join(stack.vault, "02 Projects/FDE"), join(stack.vault, "02 Projects/FDE Client"));
  await expect(lane("FDE Client")).toContainText("send deck");
  await rm(join(stack.vault, "02 Projects/FDE Client/Kickoff.md"));
  await expect(lane("No project")).toContainText("send deck");
});