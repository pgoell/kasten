import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  beforeCaret,
  bodyOf,
  cursorTo,
  hold,
  leader,
  noteText,
  openApp,
  plus,
  readAll,
  TODO_ROW,
  vaultWith,
} from "../../harness/app.ts";
import { expect, type Stack, test } from "../../harness/stack.ts";

const TOMATOES = "water the tomatoes";
const LAUNDRY = "fold the laundry";

interface Row {
  id: string;
  words: string;
  state: string;
  version: number;
}

/** Every todo the store holds, as rows. */
async function rows(stack: Stack): Promise<Row[]> {
  return (await fetch(`${stack.url}/api/todos/rows`)).json();
}

/** The store's row of the todo whose words are `words`. */
async function rowOf(stack: Stack, words: string): Promise<Row> {
  const row = (await rows(stack)).find((each) => each.words === words);
  if (row === undefined) throw new Error(`no todo says ${words}`);
  return row;
}

/** The store's row by its id, read again. */
const byId = async (stack: Stack, id: string) => (await rows(stack)).find((row) => row.id === id);

/** The running sessions, as the `## Time` lines `GET /api/todos` draws them. */
async function sessions(stack: Stack): Promise<string[]> {
  const hits: { line: number; text: string }[] = await (
    await fetch(`${stack.url}/api/todos`)
  ).json();
  return hits.filter((hit) => hit.line > 100_000).map((hit) => hit.text);
}

/** Whether a request is a store write on the todo `id`. */
const writesTo = (url: URL, id: string) => url.pathname.startsWith(`/api/todos/${id}/`);

/** Holds every store write on `id` until `release`; `arrived` waits for the first to reach the route. */
async function holdWrites(page: Page, id: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route(
    (url) => writesTo(url, id),
    async (route) => {
      if (route.request().method() === "GET") return route.fallback();
      writes += 1;
      await gate;
      await route.fallback();
    },
  );
  return { release, arrived: () => expect.poll(() => writes).toBe(1) };
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
      const hits = await response.json();
      const marker = { ...hits[0], path: "Marker.md", line: 1, text: `- [ ] ${READ}`, todo: null };
      await route.fulfill({ response, json: [...hits, marker] });
    },
  );
  return { arm: () => (armed = true) };
}

const stateOf = (page: Page, words: string, state: string) =>
  page.locator(TODO_ROW, { hasText: words }).getByRole("img", { name: state });

/** Opens the todo pane with both rows listed. */
async function openTodos(page: Page): Promise<void> {
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: `open ${LAUNDRY}` })).toBeVisible();
}

/** Opens the todo pane with `GET /api/files` held unanswered; the first store write on `id` resolves `written`. */
async function openUnlisted(page: Page, id: string) {
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/files");
  const release = await hold(page, /\/api\/files$/);
  const written = page.waitForResponse((r) => writesTo(new URL(r.url()), id));
  // Not `openApp`: the home note waits on the listing this holds back.
  await page.goto("/");
  await asked;
  await expect(page.getByRole("button", { name: "Search notes" })).toBeVisible({ timeout: 15_000 });
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: `open ${LAUNDRY}` })).toBeVisible();
  return {
    release,
    sent: async () => `${(await written).request().method()} ${(await written).status()}`,
  };
}

test("t before the file listing answers starts a session on the todo (#2061)", async ({
  page,
  stack,
}) => {
  const laundry = await rowOf(stack, LAUNDRY);
  const unlisted = await openUnlisted(page, laundry.id);
  await cursorTo(page, LAUNDRY);
  await page.keyboard.press("t");
  expect(await unlisted.sent()).toBe("POST 200");
  await expect
    .poll(() => sessions(stack))
    .toEqual([expect.stringMatching(/^- \d\d:\d\d- fold the laundry kt-/)]);
  await unlisted.release();
});

test("X before the file listing answers sets the todo done (#2061)", async ({ page, stack }) => {
  const tomatoes = await rowOf(stack, TOMATOES);
  const unlisted = await openUnlisted(page, tomatoes.id);
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  expect(await unlisted.sent()).toBe("POST 200");
  await expect.poll(async () => (await byId(stack, tomatoes.id))?.state).toBe("done");
  await unlisted.release();
});

test("a press draws the row's new state before the store has the write", async ({
  page,
  stack,
}) => {
  const tomatoes = await rowOf(stack, TOMATOES);
  const held = await holdWrites(page, tomatoes.id);
  await openTodos(page);
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  await held.arrived();
  await expect(stateOf(page, TOMATOES, "done")).toBeVisible();
  expect((await byId(stack, tomatoes.id))?.state).toBe("open");
  held.release();
  await expect.poll(async () => (await byId(stack, tomatoes.id))?.state).toBe("done");
  await expect(stateOf(page, TOMATOES, "done")).toBeVisible();
});

test("of two presses, the list is read once the last lands, not when the first does", async ({
  page,
  stack,
}) => {
  const tomatoes = await holdWrites(page, (await rowOf(stack, TOMATOES)).id);
  const laundry = await holdWrites(page, (await rowOf(stack, LAUNDRY)).id);
  const reads = await markListReads(page);
  const read = page.locator(TODO_ROW, { hasText: READ });
  await openTodos(page);
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  await cursorTo(page, LAUNDRY);
  await page.keyboard.press("W");
  await expect(stateOf(page, TOMATOES, "done")).toBeVisible();
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await tomatoes.arrived();
  reads.arm();
  tomatoes.release();
  // The second write goes out once the first lands: a list read at that landing is drawn by now.
  await laundry.arrived();
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await expect(read).toHaveCount(0);
  laundry.release();
  await expect(read).toHaveCount(1);
  await expect(stateOf(page, LAUNDRY, "waiting")).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a press of t that lands while a press of x waits leaves the list unread until the x lands", async ({
  page,
  stack,
}) => {
  const tomatoes = await holdWrites(page, (await rowOf(stack, TOMATOES)).id);
  const reads = await markListReads(page);
  const read = page.locator(TODO_ROW, { hasText: READ });
  await openTodos(page);
  // `t` first: the writes go in turn, so the timer lands before the x's write goes out.
  await cursorTo(page, LAUNDRY);
  await page.keyboard.press("t");
  await cursorTo(page, TOMATOES);
  await page.keyboard.press("X");
  await tomatoes.arrived();
  reads.arm();
  await expect(stateOf(page, TOMATOES, "done")).toBeVisible();
  await expect(read).toHaveCount(0);
  tomatoes.release();
  await expect(read).toHaveCount(1);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/** The store's row under the cursor: `data-row` names the row as `GET /api/todos` lists it. */
async function underCursor(page: Page, stack: Stack): Promise<Row> {
  const key = await page.locator(`${TODO_ROW}[tabindex="0"]`).getAttribute("data-row");
  const hits: { path: string; line: number; todo: Row | null }[] = await (
    await fetch(`${stack.url}/api/todos`)
  ).json();
  const row = hits.find((hit) => `${hit.path}:${hit.line}` === key)?.todo;
  if (!row) throw new Error(`no todo is listed as ${key}`);
  return row;
}

test("x walks the row under the cursor on to doing, and leaves the row above it open", async ({
  page,
  stack,
}) => {
  await openTodos(page);
  const first = await underCursor(page, stack);
  await page.keyboard.press("j");
  await expect(page.locator(`${TODO_ROW}[tabindex="0"]`)).not.toContainText(first.words);
  const second = await underCursor(page, stack);
  await page.keyboard.press("x");
  await expect.poll(async () => (await byId(stack, second.id))?.state).toBe("doing");
  await expect(stateOf(page, second.words, "doing")).toBeVisible();
  expect((await byId(stack, first.id))?.state).toBe("open");
});

test("a bare x walks the first row from open to doing, not to done", async ({ page, stack }) => {
  await openTodos(page);
  const first = await underCursor(page, stack);
  await page.keyboard.press("x");
  await expect.poll(async () => (await byId(stack, first.id))?.state).toBe("doing");
  await expect(stateOf(page, first.words, "doing")).toBeVisible();
});

for (const [key, state] of [
  ["B", "blocked"],
  ["V", "review"],
] as const) {
  test(`${key} sets the row under the cursor to ${state}, which the walk never reaches`, async ({
    page,
    stack,
  }) => {
    await openTodos(page);
    const first = await underCursor(page, stack);
    await page.keyboard.press(key);
    await expect.poll(async () => (await byId(stack, first.id))?.state).toBe(state);
    await expect(stateOf(page, first.words, state)).toBeVisible();
  });
}

const STATES = "02 Projects/States.md";

/**
 * Opens the todo pane on a note holding every state, with the list's answer cut to that note
 * so the legend counts its rows alone. Dates are off today: the store stamps today's date on them.
 */
async function openStates(page: Page, vault: string): Promise<void> {
  const [overdue, day, since] = [plus(-3), plus(0), plus(-7)];
  await vaultWith(vault, {
    [STATES]: [
      "# States",
      "",
      `- [ ] call the dentist 📅 ${overdue}`,
      `- [b] ship it 📅 ${overdue}`,
      `- [/] wire up the pane 📅 ${day}`,
      `- [w] decision record 📅 ${day} 👤 ${since} [[Zoe]]`,
      `- [w] hand back the keys 👤 ${since} 📅 ${day}`,
      `- [r] write the parser 📅 ${day}`,
      `- [ ] buy milk 📅 ${day}`,
      "",
    ].join("\n"),
  });
  await page.route(
    (url) => url.pathname === "/api/todos",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const hits: { path: string }[] = await response.json();
      await route.fulfill({ response, json: hits.filter((hit) => hit.path === STATES) });
    },
  );
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
      .toBe(`- [w] hand back the keys 👤 ${plus(-7)}`);
  });
});

// AltGr reads as Ctrl+Alt on Windows and Option as Alt on a Mac: either types `@` on a German layout.
for (const held of ["Control+Alt", "Alt"])
  test(`@ typed with ${held} held tags the row #agent, and is no palette chord (#2068)`, async ({
    page,
    stack,
  }) => {
    await openTodos(page);
    const row = await underCursor(page, stack);
    await page.keyboard.press(`${held}+@`);
    await expect.poll(async () => (await byId(stack, row.id))?.words).toContain("#agent");
  });

test("Ctrl+Shift+P in the todo pane opens the palette and sets no row to doing (#2068)", async ({
  page,
  stack,
}) => {
  await openTodos(page);
  const row = await underCursor(page, stack);
  await page.keyboard.press("Control+Shift+P");
  await expect(page.getByRole("dialog", { name: "Run a command" })).toBeVisible();
  expect(await byId(stack, row.id)).toEqual(row);
});

test("sends every press of x, however fast, and asks nothing", async ({ page, stack }) => {
  const tomatoes = await rowOf(stack, TOMATOES);
  const cycles: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === `/api/todos/${tomatoes.id}/cycle`)
      cycles.push(r.url());
  });
  await openTodos(page);
  await cursorTo(page, TOMATOES);
  // Open, doing, done, and back to open: each press one more version of the row.
  for (const _ of [1, 2, 3]) await page.keyboard.press("x");
  await expect
    .poll(async () => {
      const row = await byId(stack, tomatoes.id);
      return [row?.state, row?.version];
    })
    .toEqual(["open", tomatoes.version + 3]);
  expect(cycles).toHaveLength(3);
  await expect(page.getByText(/^Nothing moved/)).toHaveCount(0);
  await expect(page.locator("[data-armed]")).toHaveCount(0);
});

// The 👤 inside each span is the span's, so the name goes after the stamp at the line's end.
test.describe("#1018 the name place past a span holding a wait stamp", () => {
  const DAY = "2026-10-25";
  const SPANS = { alpha: `\`👤 ${DAY} x\``, beta: `[👤 ${DAY} x](x)`, gamma: `[[👤 ${DAY} x]]` };
  const NOTE = "02 Projects/Spans.md";
  const bodyNow = async (vault: string) => bodyOf(await noteText(vault, NOTE));

  /** Spans.md with an open todo past each span, past the import so the lines stay text. */
  async function spans(page: Page, vault: string, vim: string) {
    const lines = Object.entries(SPANS).map(([words, span]) => `- [ ] see ${span} ${words}`);
    await writeFile(join(vault, NOTE), `${lines.join("\n")}\n`);
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    await page.clock.setFixedTime(new Date(`${DAY}T12:00:00`));
    await page.goto(`/?note=${encodeURIComponent(NOTE)}`);
  }
  const named = Object.entries(SPANS).map(([w, span]) => `- [w] see ${span} ${w} 👤 ${DAY} Zoe`);

  test("A1 A3 A5 Space s w past each span puts the cursor after the stamp it wrote", async ({
    page,
    stack,
  }) => {
    await spans(page, stack.vault, "on");
    for (const words of Object.keys(SPANS)) {
      await page.locator(".cm-line", { hasText: words }).click({ timeout: 15_000 });
      await page.keyboard.press("Escape");
      await leader(page, "sw");
      await page.keyboard.type("a Zoe");
      await page.keyboard.press("Escape");
    }
    await expect.poll(() => bodyNow(stack.vault), { timeout: 15_000 }).toContain(named.join("\n"));
  });

  test("I3 vim off, the palette's waiting past each span puts the cursor after the stamp", async ({
    page,
    stack,
  }) => {
    await spans(page, stack.vault, "off");
    for (const words of Object.keys(SPANS)) {
      await page.locator(".cm-line", { hasText: words }).click({ timeout: 15_000 });
      await page.keyboard.press("Control+Shift+P");
      await page.keyboard.type("Set this todo to waiting on somebody");
      await page.keyboard.press("Enter");
      await page.keyboard.type(" Zoe");
    }
    await expect.poll(() => bodyNow(stack.vault), { timeout: 15_000 }).toContain(named.join("\n"));
  });

  test("A2 A4 A6 the pane opens the edit past each span with the cursor after the stamp", async ({
    page,
    stack,
  }) => {
    const lines = Object.entries(SPANS).map(([w, span]) => `- [w] see ${span} ${w} 👤 ${DAY}`);
    // No fixed clock: a day before the store's look-again day hides the row.
    await vaultWith(stack.vault, { [NOTE]: `${lines.join("\n")}\n` });
    await openApp(page);
    await leader(page, "gt");
    const input = page.getByLabel("edit line");
    for (const want of lines) {
      await cursorTo(page, want.split(" ").at(-3) ?? "");
      await page.keyboard.press("i");
      await expect(input).toBeFocused();
      // The store writes its own fields after the stamp; the caret stops before them.
      await expect.poll(() => beforeCaret(input)).toBe(want);
      await page.keyboard.press("Escape");
    }
  });
});
