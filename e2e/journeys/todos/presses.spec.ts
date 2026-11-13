import type { Page } from "@playwright/test";
import {
  cursorTo,
  leader,
  noteText,
  openApp,
  TODO_ROW,
  today,
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
