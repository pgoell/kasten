import type { Page } from "@playwright/test";
import {
  cursorTo,
  leader,
  noteText,
  openApp,
  panes,
  readAll,
  TODO_ROW,
  todoRows,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const NOTE = "02 Projects/Keys.md";
const LINES = [
  "- [ ] call the plumber #keys",
  "- [ ] wire up the shelf #keys",
  "- [ ] buy milk #home",
];
const note = (lines: string[]) => `# Keys\n\n${lines.join("\n")}\n`;
const region = (page: Page) => page.getByRole("region", { name: "Todos" });
const row = (page: Page, words: string) => page.locator(TODO_ROW, { hasText: words });
const cursorRow = (page: Page) => page.locator(`${TODO_ROW}[tabindex="0"]`);
const filter = (page: Page) => page.getByLabel("filter todos");
const caretLine = (page: Page) => page.locator(".cm-activeLine");
const selectedTab = (page: Page) =>
  readAll(page, '[role="tab"]', (tabs) => tabs.findIndex((tab) => tab.ariaSelected === "true"));

/** The todo pane over the three Keys rows, opened by the leader (vim on) or the palette (vim off). */
async function openPane(page: Page, vault: string, vim = "on") {
  if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await vaultWith(vault, { [NOTE]: note(LINES) });
  await openApp(page);
  if (vim === "on") await leader(page, "gt");
  else {
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
  }
  await expect(row(page, "buy milk")).toBeVisible({ timeout: 15_000 });
}

/** Three tabs, the first one holding the todo pane. */
async function threeTabs(page: Page, vault: string) {
  await vaultWith(vault, { [NOTE]: note(LINES) });
  await openApp(page);
  await leader(page, "ct");
  await leader(page, "ct");
  await expect(page.getByRole("tab")).toHaveCount(3);
  await leader(page, "1");
  await expect.poll(() => selectedTab(page)).toBe(0);
  await leader(page, "gt");
  await expect(row(page, "buy milk")).toBeVisible({ timeout: 15_000 });
}

/**
 * Deletes the plumber's todo behind the app's back, then writes its note: a store write sends no
 * event, and a note's write is what makes the pane read the todos again.
 */
async function dropPlumber(url: string, vault: string) {
  const rows: { id: string; words: string }[] = await (await fetch(`${url}/api/todos/rows`)).json();
  const plumber = rows.find((row) => row.words.includes("call the plumber"));
  await fetch(`${url}/api/todos/${plumber?.id}`, { method: "DELETE" });
  await vaultWith(vault, { [NOTE]: `${await noteText(vault, NOTE)}\n` });
}

test("j moves the cursor down a row and k moves it back up", async ({ page, stack }) => {
  await openPane(page, stack.vault);
  // Not `cursorTo`, which walks by j and k itself.
  const cursor = async () => (await todoRows(page)).cursor;
  await expect.poll(cursor).toBe(0);
  await page.keyboard.press("j");
  await expect.poll(cursor).toBe(1);
  await page.keyboard.press("k");
  await expect.poll(cursor).toBe(0);
});

test("Enter opens the note the cursor's todo is on, at its line", async ({ page, stack }) => {
  await openPane(page, stack.vault);
  await cursorTo(page, "wire up the shelf");
  await page.keyboard.press("Enter");
  await expect(caretLine(page)).toContainText("wire up the shelf #keys");
});

test("the pane takes the focus on the render that opened it", async ({ page, stack }) => {
  await openPane(page, stack.vault);
  await expect(cursorRow(page)).toBeFocused();
});

test("a write that moves the cursor's row hands the focus back to the list, and j still moves", async ({
  page,
  stack,
}) => {
  await openPane(page, stack.vault);
  await cursorTo(page, "call the plumber");
  await page.keyboard.press("X");
  await expect(row(page, "call the plumber")).toHaveCount(0);
  await expect(region(page).locator(`${TODO_ROW}:focus`)).toHaveCount(1);
  const before = await cursorRow(page).textContent();
  await page.keyboard.press("j");
  await expect(cursorRow(page)).not.toHaveText(before ?? "");
});

test("#1368 a write that redraws the rows leaves the focus in the filter line", async ({
  page,
  stack,
}) => {
  await openPane(page, stack.vault);
  await page.keyboard.press("/");
  await expect(filter(page)).toBeFocused();
  await dropPlumber(stack.url, stack.vault);
  await expect(row(page, "call the plumber")).toHaveCount(0, { timeout: 15_000 });
  await expect(filter(page)).toBeFocused();
});

test("#1368 a write that redraws the rows leaves the focus outside the pane where it was", async ({
  page,
  stack,
}) => {
  await openPane(page, stack.vault);
  const outside = page.getByRole("button", { name: "Welcome", exact: true });
  await outside.focus();
  await dropPlumber(stack.url, stack.vault);
  await expect(row(page, "call the plumber")).toHaveCount(0, { timeout: 15_000 });
  await expect(outside).toBeFocused();
});

test("/ moves the focus to the filter line", async ({ page, stack }) => {
  await openPane(page, stack.vault);
  await page.keyboard.press("/");
  await expect(filter(page)).toBeFocused();
});

test("Escape hands the list back the focus and keeps the filter applied", async ({
  page,
  stack,
}) => {
  await openPane(page, stack.vault);
  await page.keyboard.press("/");
  await page.keyboard.type("#keys");
  await expect(region(page).locator(TODO_ROW)).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(cursorRow(page)).toBeFocused();
  await expect(region(page).locator(TODO_ROW)).toHaveCount(2);
  await expect(filter(page)).toHaveValue("#keys");
});

test("the filter line takes j and k as letters, not as the list's keys", async ({
  page,
  stack,
}) => {
  await openPane(page, stack.vault);
  await cursorTo(page, "wire up the shelf");
  await page.keyboard.press("/");
  await page.keyboard.type("jk");
  await expect(filter(page)).toHaveValue("jk");
  await expect(filter(page)).toBeFocused();
});

test("the desktop footer names the keys the list binds", async ({ page, stack }) => {
  await openPane(page, stack.vault);
  const footer = page.getByTestId("todo-footer");
  for (const hint of [
    "x cycle",
    "a add",
    "s part",
    "i edit",
    "d done",
    "n next",
    "O P V X B W R state",
    "/ filter",
    "q close",
    "t timer",
    "v view",
  ])
    await expect(footer).toContainText(hint);
});

test("q closes the todo pane", async ({ page, stack }) => {
  await openPane(page, stack.vault);
  await page.keyboard.press("q");
  await expect(region(page)).toHaveCount(0);
});

test("the leader and a digit go to that tab from the focused cursor row", async ({
  page,
  stack,
}) => {
  await threeTabs(page, stack.vault);
  await expect(cursorRow(page)).toBeFocused();
  await page.keyboard.press(" ");
  await page.keyboard.press("3");
  await expect.poll(() => selectedTab(page)).toBe(2);
});

// The list reads its own keys, so Space starts the leader there with vim off too.
for (const vim of ["on", "off"])
  test(`a leader sequence typed in the list still runs: Space c t makes a tab, vim ${vim}`, async ({
    page,
    stack,
  }) => {
    await openPane(page, stack.vault, vim);
    await expect(page.getByRole("tab")).toHaveCount(1);
    await leader(page, "ct");
    await expect(page.getByRole("tab")).toHaveCount(2);
  });

test("#773 A1 Enter on a focused row that is not the cursor opens that row", async ({
  page,
  stack,
}) => {
  await openPane(page, stack.vault);
  await cursorTo(page, "call the plumber");
  await row(page, "buy milk").focus();
  await page.keyboard.press("Enter");
  await expect(caretLine(page)).toContainText("buy milk #home");
});

for (const vim of ["on", "off"]) {
  test(`#773 A1 Enter on a focused strip button presses it and opens no row, vim ${vim}`, async ({
    page,
    stack,
  }) => {
    await openPane(page, stack.vault, vim);
    const done = page.getByRole("button", { name: "d done" });
    await done.focus();
    await page.keyboard.press("Enter");
    await expect(done).toHaveAttribute("aria-pressed", "true");
    await expect(region(page)).toBeVisible();
    await expect(caretLine(page)).toHaveCount(0);
  });
}

test("#773 A2 Space on a focused row that is not the cursor opens that row and starts no leader", async ({
  page,
  stack,
}) => {
  await threeTabs(page, stack.vault);
  await cursorTo(page, "call the plumber");
  await row(page, "buy milk").focus();
  await page.keyboard.press(" ");
  await page.keyboard.press("3");
  await expect(caretLine(page)).toContainText("buy milk #home");
  await expect.poll(() => selectedTab(page)).toBe(0);
});

test("#773 I1 Enter on the focused cursor row opens its note", async ({ page, stack }) => {
  await openPane(page, stack.vault);
  await cursorTo(page, "call the plumber");
  await expect(cursorRow(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(caretLine(page)).toContainText("call the plumber #keys");
});

test("<leader>q empties the pane of the todo list and leaves the one pane", async ({
  page,
  stack,
}) => {
  await openPane(page, stack.vault);
  await leader(page, "q");
  await expect(region(page)).toHaveCount(0);
  await expect(panes(page)).toHaveCount(1);
});

test("#397 a state write the vault refuses leaves the row as it was and says Nothing moved and why", async ({
  page,
  stack,
}) => {
  await page.route("**/api/todos/*/cycle", (route) => route.fulfill({ status: 500, json: {} }));
  await openPane(page, stack.vault);
  const state = row(page, "call the plumber").locator("[data-state]");
  await cursorTo(page, "call the plumber");
  const before = await state.getAttribute("data-state");
  await page.keyboard.press("x");
  await expect(page.getByTestId("notice")).toHaveText(/^Nothing moved: .*500/);
  await expect(state).toHaveAttribute("data-state", before ?? "");
  const rows: { words: string; state: string }[] = await (
    await fetch(`${stack.url}/api/todos/rows`)
  ).json();
  expect(rows.find((one) => one.words.includes("call the plumber"))?.state).toBe("open");
});
