import type { Page } from "@playwright/test";
import {
  cursorTo,
  hold,
  leader,
  noteText,
  openApp,
  readAll,
  TODO_ROW,
  today,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const GARDEN = "02 Projects/Garden.md";
const HOME = "02 Projects/Home.md";
const TOMATOES = "water the tomatoes";
const LAUNDRY = "fold the laundry";

/** Holds every save of `path` until `release`; `arrived` waits for the first to reach the route. */
async function holdSaves(page: Page, path: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saves = 0;
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${path}`,
    async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saves += 1;
      await gate;
      await route.fallback();
    },
  );
  return { release, arrived: () => expect.poll(() => saves).toBe(1) };
}

const READ = "the list was read";

/**
 * Once armed, every answer of `GET /api/todos` carries one more row, which only the list draws:
 * a write reads the list too, but draws nothing from it.
 */
async function markListReads(page: Page): Promise<{ arm: () => void }> {
  let armed = false;
  await page.route(
    (url) => url.pathname === "/api/todos",
    async (route) => {
      if (!armed || route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const rows = await response.json();
      const marker = { ...rows[0], path: "Marker.md", line: 1, text: `- [ ] ${READ}` };
      await route.fulfill({ response, json: [...rows, marker] });
    },
  );
  return { arm: () => (armed = true) };
}

/** Holds the answer of every save of `path` until `release`, once the vault has the write. */
async function holdAnswers(page: Page, path: string) {
  let release = () => {};
  let saves = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${path}`,
    async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      saves += 1;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
  );
  return { release, arrived: () => expect.poll(() => saves).toBe(1) };
}

/** Records the path of every vault event the page's stream delivers, as the app hears them. */
async function hearEvents(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const heard: string[] = [];
    Object.assign(window, { heard });
    window.EventSource = class extends EventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("message", (event) => heard.push(JSON.parse(event.data).path));
      }
    };
  });
  return () => page.evaluate(() => (window as unknown as { heard: string[] }).heard);
}

/**
 * From here on, whether the row of `words` was ever drawn without its `state` box: a list
 * read that lands mid-press draws it back, however soon the next one puts it right.
 */
async function watchLost(page: Page, words: string, state: string): Promise<() => Promise<boolean>> {
  await page.evaluate(
    ({ words, state, row }) => {
      const flag = window as unknown as { lost: boolean };
      flag.lost = false;
      new MutationObserver(() => {
        const drawn = [...document.querySelectorAll(row)].find((each) =>
          each.textContent?.includes(words),
        );
        if (drawn && !drawn.querySelector(`[role="img"][aria-label="${state}"]`)) flag.lost = true;
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    },
    { words, state, row: TODO_ROW },
  );
  return () => page.evaluate(() => (window as unknown as { lost: boolean }).lost);
}

const stateOf = (page: Page, words: string, state: string) =>
  page.locator(TODO_ROW, { hasText: words }).getByRole("img", { name: state });

/** Opens the todo pane with both rows listed. */
async function openTodos(page: Page): Promise<void> {
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: `open ${LAUNDRY}` })).toBeVisible();
}

/** Opens the todo pane with `GET /api/files` held unanswered; the first write to `path` resolves `written`. */
async function openUnlisted(page: Page, path: string) {
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/files");
  const release = await hold(page, /\/api\/files$/);
  const written = page.waitForResponse(
    (r) => decodeURIComponent(new URL(r.url()).pathname) === `/api/files/${path}` && r.request().method() !== "GET",
  );
  // Not `openApp`: the home note waits on the listing this holds back.
  await page.goto("/");
  await asked;
  await expect(page.getByRole("button", { name: "Search notes" })).toBeVisible({ timeout: 15_000 });
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: `open ${LAUNDRY}` })).toBeVisible();
  return { release, sent: async () => `${(await written).request().method()} ${(await written).status()}` };
}

test("t before the file listing answers starts a session in today's note (#2061)", async ({ page, stack }) => {
  const unlisted = await openUnlisted(page, HOME);
  await cursorTo(page, LAUNDRY);
  await page.keyboard.press("t");
  expect(await unlisted.sent()).toBe("PUT 200");
  await expect
    .poll(() => noteText(stack.vault, `01 Periodic/00 Daily/${today()}.md`).catch(() => ""))
    .toMatch(/^- \d\d:\d\d-.*fold the laundry/m);
  await unlisted.release();
});

test("x before the file listing answers moves the todo in its own note (#2061)", async ({ page, stack }) => {
  const unlisted = await openUnlisted(page, GARDEN);
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  expect(await unlisted.sent()).toBe("PUT 200");
  await expect.poll(() => noteText(stack.vault, GARDEN)).toMatch(/^- \[x\] water the tomatoes/m);
  await unlisted.release();
});

test("a press draws the row's new state before the vault has the write", async ({
  page,
  stack,
}) => {
  const garden = await holdSaves(page, GARDEN);
  await openTodos(page);
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  await garden.arrived();
  await expect(stateOf(page, TOMATOES, "done")).toBeVisible();
  expect(await noteText(stack.vault, GARDEN)).toMatch(/^- \[ \] water the tomatoes/m);
  garden.release();
  await expect
    .poll(() => noteText(stack.vault, GARDEN))
    .toMatch(/^- \[x\] water the tomatoes/m);
  await expect(stateOf(page, TOMATOES, "done")).toBeVisible();
});

test("of two presses, the list is read once the last lands, not when the first does", async ({
  page,
  stack,
}) => {
  const garden = await holdSaves(page, GARDEN);
  const home = await holdSaves(page, HOME);
  const reads = await markListReads(page);
  const read = page.locator(TODO_ROW, { hasText: READ });
  await openTodos(page);
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  await cursorTo(page, LAUNDRY);
  await page.keyboard.press("W");
  await expect(stateOf(page, TOMATOES, "done")).toBeVisible();
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await garden.arrived();
  // From here: the first write has read all it reads before its save.
  reads.arm();
  garden.release();
  // The second write goes out once the first lands: a list read at that landing is drawn by now.
  await home.arrived();
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await expect(read).toHaveCount(0);
  home.release();
  await expect(read).toHaveCount(1);
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a press of t that lands while a press of x waits leaves the list unread until the x lands", async ({
  page,
  stack,
}) => {
  const garden = await holdSaves(page, GARDEN);
  const reads = await markListReads(page);
  const read = page.locator(TODO_ROW, { hasText: READ });
  await openTodos(page);
  // `t` first: the writes go in turn, so the timer lands before the x's save goes out.
  await cursorTo(page, LAUNDRY);
  await page.keyboard.press("t");
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  await garden.arrived();
  reads.arm();
  await expect(stateOf(page, TOMATOES, "done")).toBeVisible();
  await expect(read).toHaveCount(0);
  garden.release();
  await expect(read).toHaveCount(1);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a press's own event that beats its save's answer leaves a pending press's row as drawn", async ({
  page,
  stack,
}) => {
  const heard = await hearEvents(page);
  const garden = await holdAnswers(page, GARDEN);
  const home = await holdSaves(page, HOME);
  const reads = await markListReads(page);
  const read = page.locator(TODO_ROW, { hasText: READ });
  await openTodos(page);
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  await cursorTo(page, LAUNDRY);
  await page.keyboard.press("W");
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await garden.arrived();
  reads.arm();
  // The vault has the Garden write and the page its event, while the save still waits on its answer.
  await expect.poll(heard).toContain(GARDEN);
  garden.release();
  // The done log and the Home save go out only once Garden lands: an early list read is drawn by now.
  await home.arrived();
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await expect(read).toHaveCount(0);
  home.release();
  await expect(read).toHaveCount(1);
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a press that makes today's daily note leaves a pending press's row as drawn (#1998)", async ({
  page,
  stack,
}) => {
  const daily = `01 Periodic/00 Daily/${today()}.md`;
  expect(await noteText(stack.vault, daily)).toBe("");
  const heard = await hearEvents(page);
  const garden = await holdSaves(page, GARDEN);
  const home = await holdSaves(page, HOME);
  const reads = await markListReads(page);
  const read = page.locator(TODO_ROW, { hasText: READ });
  await openTodos(page);
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  await cursorTo(page, LAUNDRY);
  await page.keyboard.press("W");
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await garden.arrived();
  reads.arm();
  const lost = await watchLost(page, LAUNDRY, "waiting");
  garden.release();
  // The done log makes the daily note and its folders: their listing and index writes reach the page.
  await expect.poll(heard).toContain("01 Periodic/index.md");
  await expect.poll(heard).toContain("01 Periodic/00 Daily/index.md");
  await home.arrived();
  home.release();
  // The read once the last press lands, which comes after any read the events made.
  await expect(read).toHaveCount(1);
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  expect(await lost()).toBe(false);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/** The note's line that holds `words`, read off disk: a save may add frontmatter above it. */
async function lineWith(vault: string, path: string, words: string): Promise<string> {
  return (await noteText(vault, path)).split("\n").find((line) => line.endsWith(` ${words}`)) ?? "";
}

/** The path and words of the row under the cursor, read off disk; `data-row` counts from 1. */
async function underCursor(page: Page, vault: string): Promise<{ path: string; words: string }> {
  const key = (await page.locator(`${TODO_ROW}[tabindex="0"]`).getAttribute("data-row")) ?? "";
  const path = key.slice(0, key.lastIndexOf(":"));
  const line = (await noteText(vault, path)).split("\n")[
    Number(key.slice(key.lastIndexOf(":") + 1)) - 1
  ];
  return { path, words: line?.replace(/^- \[ \] /, "") ?? "" };
}

test("x walks the row under the cursor on to doing, and leaves the row above it open", async ({
  page,
  stack,
}) => {
  await openTodos(page);
  const first = await underCursor(page, stack.vault);
  await page.keyboard.press("j");
  await expect(page.locator(`${TODO_ROW}[tabindex="0"]`)).not.toContainText(first.words);
  const second = await underCursor(page, stack.vault);
  await page.keyboard.press("x");
  await expect
    .poll(() => lineWith(stack.vault, second.path, second.words))
    .toBe(`- [/] ${second.words}`);
  await expect(stateOf(page, second.words, "doing")).toBeVisible();
  expect(await lineWith(stack.vault, first.path, first.words)).toBe(`- [ ] ${first.words}`);
});

test("a bare x walks the first row from open to doing, not to done", async ({ page, stack }) => {
  await openTodos(page);
  const first = await underCursor(page, stack.vault);
  await page.keyboard.press("x");
  await expect
    .poll(() => lineWith(stack.vault, first.path, first.words))
    .toBe(`- [/] ${first.words}`);
  await expect(stateOf(page, first.words, "doing")).toBeVisible();
});

for (const [key, state, mark] of [
  ["B", "blocked", "b"],
  ["V", "review", "r"],
] as const) {
  test(`${key} sets the row under the cursor to ${state}, which the walk never reaches`, async ({
    page,
    stack,
  }) => {
    await openTodos(page);
    const first = await underCursor(page, stack.vault);
    await page.keyboard.press(key);
    await expect
      .poll(() => lineWith(stack.vault, first.path, first.words))
      .toBe(`- [${mark}] ${first.words}`);
    await expect(stateOf(page, first.words, state)).toBeVisible();
  });
}

const STATES = "02 Projects/States.md";

/**
 * Opens the todo pane on a note holding every state, on a clock fixed at noon of 2026-08-10, with
 * the list's answer cut to that note so the legend counts its rows alone.
 */
async function openStates(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, {
    [STATES]: [
      "# States",
      "",
      "- [ ] call the dentist 📅 2026-08-07",
      "- [b] ship it 📅 2026-08-07",
      "- [/] wire up the pane 📅 2026-08-10",
      "- [w] decision record 📅 2026-08-10 👤 2026-08-03 [[Zoe]]",
      "- [w] hand back the keys 👤 2026-08-03 📅 2026-08-10",
      "- [r] write the parser 📅 2026-08-10",
      "- [ ] buy milk 📅 2026-08-10",
      "",
    ].join("\n"),
  });
  await page.route(
    (url) => url.pathname === "/api/todos",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const rows: { path: string }[] = await response.json();
      await route.fulfill({ response, json: rows.filter((row) => row.path === STATES) });
    },
  );
  await page.clock.setFixedTime(new Date("2026-08-10T12:00:00"));
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(TODO_ROW)).toHaveCount(7);
}

test.describe("the open list's states", () => {
  test("blocked and waiting rows are muted in their date's section, review is not, and the legend counts each state", async ({
    page,
    stack,
  }) => {
    await openStates(page, stack.vault);
    // Headings and rows in the order drawn, read in one evaluate (#1937), each row by its colour.
    const drawn = await readAll(page, `h3, ${TODO_ROW}`, (all) =>
      all.map((node) =>
        node.tagName === "H3"
          ? (node.textContent ?? "").toLowerCase()
          : `${getComputedStyle(node).color} ${node.textContent}`,
      ),
    );
    const colour = (words: string) => drawn.find((line) => line.includes(words))?.split(") ")[0];
    const at = (words: string) => drawn.findIndex((line) => line.includes(words));
    expect(at("ship it")).toBeGreaterThan(at("overdue"));
    expect(at("ship it")).toBeLessThan(at("today"));
    expect(at("decision record")).toBeGreaterThan(at("today"));
    expect(colour("ship it")).toBe(colour("decision record"));
    expect(colour("ship it")).not.toBe(colour("buy milk"));
    expect(colour("write the parser")).toBe(colour("buy milk"));
    await expect(stateOf(page, "write the parser", "review")).toBeVisible();
    await expect(stateOf(page, "decision record", "waiting")).toBeVisible();
    await expect(page.locator(TODO_ROW, { hasText: "decision record" })).toContainText("👤 7d Zoe");

    const legend = page.getByTestId("todo-footer").getByRole("list", { name: "legend" });
    await expect(legend).toBeVisible();
    const counts = await readAll(page, '[aria-label="legend"] li', (all) =>
      Object.fromEntries(all.map((li) => [li.title, Number(li.textContent)])),
    );
    expect(counts).toMatchObject({ open: 2, doing: 1, blocked: 1, waiting: 2, review: 1 });
    await expect(page.getByRole("button", { name: /^Shared lists/ })).toHaveCount(0);
  });

  test("the filter finds a waiting row by the name it waits on", async ({ page, stack }) => {
    await openStates(page, stack.vault);
    await page.getByLabel("filter todos").fill("zoe");
    await expect(page.locator(TODO_ROW)).toHaveCount(1);
    await expect(page.locator(TODO_ROW)).toContainText("decision record");
  });

  test("i on a waiting row that names nobody puts the caret where the name goes", async ({
    page,
    stack,
  }) => {
    await openStates(page, stack.vault);
    await cursorTo(page, "hand back the keys");
    await page.keyboard.press("i");
    const input = page.getByLabel("edit line");
    await expect(input).toBeFocused();
    await expect
      .poll(() =>
        input.evaluate((field: HTMLInputElement) =>
          field.value.slice(0, field.selectionStart ?? 0),
        ),
      )
      .toBe("- [w] hand back the keys 👤 2026-08-03");
  });
});

// AltGr reads as Ctrl+Alt on Windows and Option as Alt on a Mac: either types `@` on a German layout.
for (const held of ["Control+Alt", "Alt"])
  test(`@ typed with ${held} held tags the row #agent, and is no palette chord (#2068)`, async ({
    page,
    stack,
  }) => {
    await openTodos(page);
    const row = await underCursor(page, stack.vault);
    await page.keyboard.press(`${held}+@`);
    await expect
      .poll(async () =>
        (await noteText(stack.vault, row.path))
          .split("\n")
          .some((line) => line.includes(row.words) && line.includes("#agent")),
      )
      .toBe(true);
  });

test("Ctrl+Shift+P in the todo pane opens the palette and sets no row to doing (#2068)", async ({
  page,
  stack,
}) => {
  await openTodos(page);
  const row = await underCursor(page, stack.vault);
  await page.keyboard.press("Control+Shift+P");
  await expect(page.getByRole("dialog", { name: "Run a command" })).toBeVisible();
  expect(await lineWith(stack.vault, row.path, row.words)).toBe(`- [ ] ${row.words}`);
});
