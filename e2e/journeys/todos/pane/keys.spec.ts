import type { Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bodyOf,
  cursorTo,
  leader,
  noteText,
  openApp,
  panes,
  phone,
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

/** Drops the plumber's line from the note behind the app's back, as a write from elsewhere. */
const dropPlumber = (vault: string) => writeFile(join(vault, NOTE), note(LINES.slice(1)));

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
  await expect(caretLine(page)).toHaveText("wire up the shelf #keys");
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
  await dropPlumber(stack.vault);
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
  await dropPlumber(stack.vault);
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
  await expect(caretLine(page)).toHaveText("buy milk #home");
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
  await expect(caretLine(page)).toHaveText("call the plumber #keys");
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
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${NOTE}`,
    (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 500, json: { detail: "refused by the test" } })
        : route.fallback(),
  );
  await openPane(page, stack.vault);
  const state = row(page, "call the plumber").locator("[data-state]");
  await cursorTo(page, "call the plumber");
  const before = await state.getAttribute("data-state");
  await page.keyboard.press("x");
  await expect(page.getByTestId("notice")).toHaveText(/^Nothing moved: .*500/);
  await expect(state).toHaveAttribute("data-state", before ?? "");
  expect(bodyOf(await noteText(stack.vault, NOTE))).toBe(note(LINES));
});

/** The pane over `lines`, then `moved` written from outside while the stream is held, so the list stays as listed. */
async function listedThenMoved(
  page: Page,
  vault: string,
  lines: string[],
  moved: string[],
  words: string,
) {
  await page.route("**/api/events", () => new Promise(() => {}));
  await vaultWith(vault, { [NOTE]: note(lines) });
  await openApp(page);
  await leader(page, "gt");
  await expect(row(page, words).first()).toBeVisible({ timeout: 15_000 });
  await vaultWith(vault, { [NOTE]: note(moved) });
}

test("#529 t on a row whose line has changed since it was listed writes nothing and says so", async ({
  page,
  stack,
}) => {
  const puts: string[] = [];
  page.on("request", (request) => request.method() === "PUT" && puts.push(request.url()));
  const moved = ["- [ ] ring the plumber #keys", ...LINES.slice(1)];
  await listedThenMoved(page, stack.vault, LINES, moved, "buy milk");
  await cursorTo(page, "call the plumber");
  await page.keyboard.press("t");
  await expect(page.getByTestId("notice")).toHaveText(
    "Nothing moved: that line has changed since it was listed",
  );
  expect(puts).toEqual([]);
  expect(bodyOf(await noteText(stack.vault, NOTE))).toBe(note(moved));
});

test("#530 X on the second of two twins sets that twin after a line above shifted both", async ({
  page,
  stack,
}) => {
  const twins = ["- [ ] water the fern", "- [ ] water the fern"];
  await listedThenMoved(page, stack.vault, twins, ["- [ ] buy milk", ...twins], "water the fern");
  await cursorTo(page, "water the fern", 1);
  await page.keyboard.press("X");
  await expect
    .poll(async () =>
      bodyOf(await noteText(stack.vault, NOTE))
        .split("\n")
        .slice(2, 5),
    )
    .toEqual([
      "- [ ] buy milk",
      "- [ ] water the fern",
      expect.stringMatching(/^- \[x\] water the fern/),
    ]);
});

const PLUMBER = "call the plumber";
const RENAMED = ["- [ ] ring the plumber #keys", ...LINES.slice(1)];
const ABOVE = ["- [ ] feed the cat #home", ...LINES];
const CHANGED = "Nothing moved: that line has changed since it was listed";
const BLOCKER_CHANGED = "Nothing moved: the blocker's line has changed since it was listed";
const prompt = (page: Page) => page.getByRole("dialog", { name: "Add part" }).getByRole("textbox");
const keysBody = async (vault: string) => bodyOf(await noteText(vault, NOTE));

/** The pane over the Keys rows with the event stream held, so the list stays as listed while the note changes on disk. */
async function heldPane(page: Page, vault: string, vim: string) {
  await page.route("**/api/events", () => new Promise(() => {}));
  if (vim !== "tap") return openPane(page, vault, vim);
  await vaultWith(vault, { [NOTE]: note(LINES) });
  await page.goto("/");
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  await expect(row(page, "buy milk")).toBeVisible({ timeout: 15_000 });
}

/** `s` on the plumber's row (by key, or the phone's `part`), the note set to `lines` meanwhile, then "kilo" sent. */
async function partAfter(page: Page, vault: string, vim: string, lines: string[]) {
  if (vim === "tap") {
    await page.getByLabel(new RegExp(`^more for ${PLUMBER}`)).tap();
    await page.getByLabel(new RegExp(`^part ${PLUMBER}`)).tap();
  } else {
    await cursorTo(page, PLUMBER);
    await page.keyboard.press("s");
  }
  await vaultWith(vault, { [NOTE]: note(lines) });
  await prompt(page).fill("kilo");
  await prompt(page).press("Enter");
}

/** `b` on the plumber's row (by key, or the phone's `blocked by`), the note set to `lines` meanwhile, then "buy milk" picked. */
async function blockAfter(page: Page, vault: string, vim: string, lines: string[]) {
  if (vim === "tap") {
    await page.getByLabel(new RegExp(`^more for ${PLUMBER}`)).tap();
    await page.getByLabel(new RegExp(`^blocked by ${PLUMBER}`)).tap();
    await vaultWith(vault, { [NOTE]: note(lines) });
    await row(page, "buy milk").tap();
    return;
  }
  await cursorTo(page, PLUMBER);
  await page.keyboard.press("b");
  await vaultWith(vault, { [NOTE]: note(lines) });
  await cursorTo(page, "buy milk");
  await page.keyboard.press("Enter");
}

const PART = /call the plumber #keys\n {2}- \[ \] kilo\b/;

for (const vim of ["on", "off", "tap"]) {
  test.describe(`#2212 a row whose line changed since it was listed, vim ${vim}`, () => {
    if (vim === "tap") test.use(phone);

    test("s writes nothing, says so, keeps the part, and sends it once the line reads as before", async ({
      page,
      stack,
    }) => {
      await heldPane(page, stack.vault, vim);
      await partAfter(page, stack.vault, vim, RENAMED);
      await expect(page.getByTestId("notice")).toHaveText(CHANGED);
      await expect(prompt(page)).toHaveValue("kilo");
      expect(await keysBody(stack.vault)).toBe(note(RENAMED));
      await vaultWith(stack.vault, { [NOTE]: note(LINES) });
      await prompt(page).press("Enter");
      await expect.poll(() => keysBody(stack.vault)).toMatch(PART);
    });

    test("b writes nothing and says so", async ({ page, stack }) => {
      await heldPane(page, stack.vault, vim);
      await blockAfter(page, stack.vault, vim, RENAMED);
      await expect(page.getByTestId("notice")).toHaveText(CHANGED);
      expect(await keysBody(stack.vault)).toBe(note(RENAMED));
    });
  });
}

test.describe("#2212 a row that only moved since it was listed", () => {
  test("s lands the part under it, found by its words", async ({ page, stack }) => {
    await heldPane(page, stack.vault, "on");
    await partAfter(page, stack.vault, "on", ABOVE);
    await expect.poll(() => keysBody(stack.vault)).toMatch(PART);
    await expect(prompt(page)).toHaveCount(0);
  });

  test("b lands the blocker on it, found by its words", async ({ page, stack }) => {
    await heldPane(page, stack.vault, "on");
    await blockAfter(page, stack.vault, "on", ABOVE);
    await expect.poll(() => keysBody(stack.vault)).toMatch(/call the plumber #keys ⛔ kt-/);
  });
});

test("#2212 b whose blocker's line changed since it was listed writes nothing and says so", async ({
  page,
  stack,
}) => {
  const moved = [...LINES.slice(0, 2), "- [ ] buy oat milk #home"];
  await heldPane(page, stack.vault, "on");
  await cursorTo(page, PLUMBER);
  await page.keyboard.press("b");
  await vaultWith(stack.vault, { [NOTE]: note(moved) });
  await cursorTo(page, "buy milk");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("notice")).toHaveText(BLOCKER_CHANGED);
  expect(await keysBody(stack.vault)).toBe(note(moved));
});

test("#2212 an s write the vault refuses says why and keeps the part", async ({ page, stack }) => {
  await page.route("**/api/files/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, body: "" })
      : route.fallback(),
  );
  await heldPane(page, stack.vault, "on");
  await partAfter(page, stack.vault, "on", LINES);
  await expect(page.getByTestId("notice")).toHaveText(/^Nothing moved: .*500/);
  await expect(prompt(page)).toHaveValue("kilo");
});
