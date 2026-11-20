import type { Page } from "@playwright/test";
import {
  cursorTo,
  holdStream,
  leader,
  noteText,
  openApp,
  panes,
  readAll,
  runCommand,
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
const notice = (page: Page) => page.getByTestId("notice");
const field = (page: Page, what = "part") =>
  page.getByRole("dialog", { name: `Add ${what}` }).getByRole("textbox");
type Row = {
  id: string;
  words: string;
  version: number;
  parent_id: string | null;
  blocked_by: string[];
  state: string;
};
const rowOf = async (url: string, words: string): Promise<Row | undefined> =>
  ((await (await fetch(`${url}/api/todos/rows`)).json()) as Row[]).find((one) =>
    one.words.includes(words),
  );
const selectedTab = (page: Page) =>
  readAll(page, '[role="tab"]', (tabs) => tabs.findIndex((tab) => tab.ariaSelected === "true"));

/** The todo pane over the three Keys rows, opened by the leader (vim on) or the palette (vim off). */
async function openPane(page: Page, vault: string, vim = "on") {
  if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await vaultWith(vault, { [NOTE]: note(LINES) });
  await openApp(page);
  if (vim === "on") await leader(page, "gt");
  else await runCommand(page, /^Open the todo pane/);
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
  await drop(url, vault, "call the plumber");
}

/** Deletes the todo with `words` from the store, then writes the note as `dropPlumber` does. */
async function drop(url: string, vault: string, words: string) {
  const { id } = (await rowOf(url, words)) as Row;
  expect((await fetch(`${url}/api/todos/${id}`, { method: "DELETE" })).ok).toBe(true);
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

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

/** The store row behind `words`, deleted or its words changed with the stream held, so the pane still lists it as it was. */
async function behindTheList(page: Page, url: string, words: string, change: "delete" | "edit") {
  const { id, version } = (await rowOf(url, words)) as Row;
  const edit = { method: "PUT", body: JSON.stringify({ text: `- [ ] ${words} again`, version }) };
  const init = change === "delete" ? { method: "DELETE" } : edit;
  const path = change === "delete" ? id : `${id}/line`;
  const sent = await fetch(`${url}/api/todos/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  expect(sent.ok).toBe(true);
  await expect(row(page, words)).toBeVisible();
}

/** `s` on `words`, a part typed and Enter. */
async function part(page: Page, words: string, typed: string) {
  await cursorTo(page, words);
  await page.keyboard.press("s");
  await field(page).fill(typed);
  await page.keyboard.press("Enter");
}

/** `b` on `words`, and `blocker` picked by Enter. */
async function block(page: Page, words: string, blocker: string) {
  await cursorTo(page, words);
  await page.keyboard.press("b");
  await expect(page.getByTestId("todo-pick")).toBeVisible();
  await cursorTo(page, blocker);
  await page.keyboard.press("Enter");
}

for (const vim of ["on", "off"]) {
  test(`#2212 an s the store refuses says why and keeps the part for Enter to send again, vim ${vim}`, async ({
    page,
    stack,
  }) => {
    let refuse = true;
    await page.route("**/api/todos/line", (route) =>
      refuse ? route.fulfill({ status: 500, json: {} }) : route.fallback(),
    );
    await openPane(page, stack.vault, vim);
    await part(page, "call the plumber", "ask about the boiler");
    await expect(notice(page)).toHaveText(/^Nothing moved: .*500/);
    await expect(field(page)).toHaveValue("ask about the boiler");
    refuse = false;
    await page.keyboard.press("Enter");
    const parent = (await rowOf(stack.url, "call the plumber"))?.id;
    await expect.poll(async () => (await rowOf(stack.url, "ask about"))?.parent_id).toBe(parent);
    await expect(notice(page)).toHaveCount(0);
  });

  test(`#2212 a b on a todo changed since it was listed writes nothing and says so, vim ${vim}`, async ({
    page,
    stack,
  }) => {
    await holdStream(page);
    await openPane(page, stack.vault, vim);
    await behindTheList(page, stack.url, "wire up the shelf", "edit");
    await block(page, "wire up the shelf", "buy milk");
    await expect(notice(page)).toHaveText(/^Nothing moved: .*changed since it was read/);
    expect((await rowOf(stack.url, "wire up the shelf"))?.blocked_by).toEqual([]);
  });
}

test("#2212 an s under a todo deleted since it was listed says why, keeps the part and lands nothing", async ({
  page,
  stack,
}) => {
  await holdStream(page);
  await openPane(page, stack.vault);
  await behindTheList(page, stack.url, "call the plumber", "delete");
  await part(page, "call the plumber", "ask about the boiler");
  await expect(notice(page)).toHaveText(/^Nothing moved: No todo has the id/);
  await expect(field(page)).toHaveValue("ask about the boiler");
  expect(await rowOf(stack.url, "ask about")).toBeUndefined();
});

test("#2212 an s under a todo changed since it was listed lands the part under it", async ({
  page,
  stack,
}) => {
  await holdStream(page);
  await openPane(page, stack.vault);
  await behindTheList(page, stack.url, "call the plumber", "edit");
  await part(page, "call the plumber", "ask about the boiler");
  const parent = (await rowOf(stack.url, "call the plumber"))?.id;
  await expect.poll(async () => (await rowOf(stack.url, "ask about"))?.parent_id).toBe(parent);
  await expect(notice(page)).toHaveCount(0);
});

for (const gone of ["row", "blocker"])
  test(`#2212 a b whose ${gone} was deleted since it was listed writes nothing and says so`, async ({
    page,
    stack,
  }) => {
    await holdStream(page);
    await openPane(page, stack.vault);
    await behindTheList(
      page,
      stack.url,
      gone === "row" ? "wire up the shelf" : "buy milk",
      "delete",
    );
    await block(page, "wire up the shelf", "buy milk");
    await expect(notice(page)).toHaveText(/^Nothing moved: No todo has the id/);
    expect((await rowOf(stack.url, "wire up the shelf"))?.blocked_by ?? []).toEqual([]);
  });

test("#2219 deleting the todo a row waits on takes its ⛔ off and opens the row", async ({
  page,
  stack,
}) => {
  await openPane(page, stack.vault);
  await block(page, "wire up the shelf", "buy milk");
  await expect(row(page, "wire up the shelf")).toContainText("⛔");
  await drop(stack.url, stack.vault, "buy milk");
  await expect(row(page, "wire up the shelf")).not.toContainText("⛔", { timeout: 15_000 });
  expect((await rowOf(stack.url, "wire up the shelf"))?.state).toBe("open");
});

test("#2212 a b the store refuses says why", async ({ page, stack }) => {
  await page.route("**/api/todos/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: {} })
      : route.fallback(),
  );
  await openPane(page, stack.vault);
  await block(page, "wire up the shelf", "buy milk");
  await expect(notice(page)).toHaveText(/^Nothing moved: .*500/);
});

test("#2212 an a the store refuses says why, keeps the todo, and Escape then writes nothing", async ({
  page,
  stack,
}) => {
  await page.route("**/api/todos/line", (route) => route.fulfill({ status: 500, json: {} }));
  await openPane(page, stack.vault);
  await page.keyboard.press("a");
  await field(page, "todo").fill("book the boiler service");
  await page.keyboard.press("Enter");
  await expect(notice(page)).toHaveText(/^Nothing moved: .*500/);
  await expect(field(page, "todo")).toHaveValue("book the boiler service");
  await page.keyboard.press("Escape");
  await expect(field(page, "todo")).toHaveCount(0);
  expect(await rowOf(stack.url, "boiler service")).toBeUndefined();
});
