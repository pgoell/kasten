import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  cursorTo,
  leader,
  openApp,
  phone,
  readAll,
  TODO_ROW,
  today,
  todoRows,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const HOME_TODOS = [
  "empty the dishwasher",
  "fold the laundry",
  "take out the bins",
  "water the plants",
  "ask the landlord about the boiler",
];

const HOME = "02 Projects/Home.md";

/** Every todo in the store, as `GET /api/todos` renders each one, a line apiece. */
async function store(url: string): Promise<string> {
  const hits = (await (await fetch(`${url}/api/todos`)).json()) as { text: string }[];
  return hits.map((hit) => hit.text).join("\n");
}

test("checking off a todo in the todo pane changes it in the store", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
  // The first row starts under the cursor; X sets it done.
  await page.keyboard.press("X");
  await expect
    .poll(() => store(stack.url), { timeout: 15_000 })
    .toMatch(/^- \[x\] water the tomatoes/m);
});

test("with a mouse the todo pane draws no touch buttons, and each press of x walks the row and asks nothing", async ({
  page,
  stack,
}) => {
  const garden = () => store(stack.url);
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
  for (const name of ["add todo", /^cycle /, /^more for /]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  for (const name of ["done", "next", "view"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  // One press at a time: a second press before the first lands is refused as stale (#2080).
  await page.keyboard.press("x");
  await expect.poll(garden, { timeout: 15_000 }).toMatch(/^- \[\/\] water the tomatoes/m);
  await expect(page.getByRole("button", { name: "doing water the tomatoes" })).toBeFocused();
  await page.keyboard.press("x");
  await expect.poll(garden, { timeout: 15_000 }).toMatch(/^- \[x\] water the tomatoes/m);
  await expect(page.locator("[data-armed]")).toHaveCount(0);
});

test("two x presses straight after each other walk the row on to done (#2080)", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
  await page.keyboard.press("x");
  await page.keyboard.press("x");
  await expect
    .poll(() => store(stack.url), { timeout: 15_000 })
    .toMatch(/^- \[x\] water the tomatoes/m);
  await expect(page.getByText(/^Nothing moved/)).toHaveCount(0);
});

test("t straight after an x starts a session on the todo the x walked (#2084)", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
  await page.keyboard.press("x");
  await page.keyboard.press("t");
  // The listing draws a running session as the `## Time` line the timer reads.
  await expect
    .poll(() => store(stack.url), { timeout: 15_000 })
    .toMatch(/^- \d\d:\d\d- .*water the tomatoes/m);
  expect(await store(stack.url)).toMatch(/^- \[\/\] water the tomatoes/m);
  await expect(page.getByText(/^Nothing moved/)).toHaveCount(0);
});

test("clicking a todo opens its note on the todo's embed", async ({ page }) => {
  await openApp(page);
  await leader(page, "gt");
  await page.getByRole("button", { name: "open reply to the far away letter" }).click();
  const line = page.locator(".cm-line", { hasText: "reply to the far away letter" });
  await expect(line).toBeInViewport();
  await expect(page.locator(".cm-activeLine")).toContainText("reply to the far away letter");
});

test("checking off three todos in a row keeps the rows in their order, then they leave", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "gt");
  // A checked row stays put, struck through, while presses follow each other (#947),
  // so each row is found again by its words.
  for (const name of HOME_TODOS.slice(0, 3)) {
    await cursorTo(page, name);
    await page.keyboard.press("X");
  }
  const named = async () =>
    (await todoRows(page)).texts
      .map((text) => HOME_TODOS.find((name) => text.includes(name)))
      .filter((name) => name !== undefined);
  expect(await named()).toEqual(HOME_TODOS);
  await expect
    .poll(() => store(stack.url), { timeout: 15_000 })
    .toMatch(
      /^- \[x\] empty the dishwasher.*\n- \[x\] fold the laundry.*\n- \[x\] take out the bins/m,
    );
  // A beat after the last press the done rows leave, the cursor's own among them, so
  // the cursor lands on the first row under it that stays.
  await expect.poll(named).toEqual(HOME_TODOS.slice(3));
  await expect(page.locator(`${TODO_ROW}[tabindex="0"]`)).toContainText(HOME_TODOS[3] ?? "");
});

test("a list read in one step holds one render, where a read in two steps mixes two (#1937)", async ({
  page,
  stack,
}) => {
  const WORDS = ["alpha", "bravo", "charlie"];
  // Every line moves down one, so row Home.md:3 goes and :4 and :5 stay, holding new text.
  const lines = (from: number) =>
    WORDS.map((word, at) => ({ path: HOME, line: from + at, text: `- [ ] ${word}` }));
  let answer = lines(3);
  let release = () => {};
  const gate = new Promise<void>((open) => {
    release = open;
  });
  await page.route("**/api/todos?**", async (route) => {
    const held = answer;
    if (held[0]?.line === 4) await gate;
    await route.fulfill({ json: held });
  });
  await openApp(page);
  await leader(page, "gt");
  const rows = page.locator(TODO_ROW);
  const named = (texts: (string | null)[]) =>
    texts.map((text) => WORDS.find((word) => text?.includes(word)));
  const oneStep = async () =>
    named(await readAll(page, TODO_ROW, (all) => all.map((row) => row.textContent)));
  await expect.poll(oneStep).toEqual(WORDS);

  answer = lines(4);
  await writeFile(join(stack.vault, "Elsewhere.md"), "a write the vault's events carry\n");
  // The first trip of a two-step read: the nodes, found before the answer lands.
  const handles = await rows.elementHandles();
  release();
  await expect(page.locator(`${TODO_ROW}[data-row$=".md:6"]`)).toHaveCount(1);
  // Its second trip, after React committed: a detached row beside the rows it kept.
  const twoStep = named(await Promise.all(handles.map((handle) => handle.textContent())));
  expect(twoStep).toEqual(["alpha", "alpha", "bravo"]);
  expect(await oneStep()).toEqual(WORDS);
});

test("marking a recurring todo done keeps it open on its next date and writes the round done", async ({
  page,
  stack,
}) => {
  // The next round counts off the due date. A dated todo would head the list, so it is found by its words.
  await vaultWith(stack.vault, {
    "02 Projects/Cat.md": "- [ ] feed the cat 📅 2026-11-10 🔁 every week\n",
  });
  await openApp(page);
  await leader(page, "gt");
  await cursorTo(page, "feed the cat");
  await page.keyboard.press("X");
  await expect
    .poll(() => store(stack.url), { timeout: 15_000 })
    .toMatch(/^- \[x\] feed the cat .*✅/m);
  expect(await store(stack.url)).toMatch(/^- \[ \] feed the cat 🔁 every week .*📅 2026-11-17/m);
});

test("setting a todo to waiting marks it in the store and on its row", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "gt");
  await cursorTo(page, "ask the landlord about the boiler");
  await page.keyboard.press("W");
  await expect
    .poll(() => store(stack.url), { timeout: 15_000 })
    .toMatch(/^- \[w\] ask the landlord about the boiler/m);
  const row = page.locator(TODO_ROW, { hasText: "ask the landlord about the boiler" });
  await expect(row.getByRole("img", { name: "waiting" })).toBeVisible();
});

test("the filter narrows to a tag or away from it with parts beside their parent, ands its terms, and reads a tag in brackets", async ({
  page,
  stack,
}) => {
  const note = "02 Projects/Filter.md";
  await vaultWith(stack.vault, {
    [note]: [
      "# Filter",
      "",
      "- [ ] send the offer #client",
      "  - [ ] check the numbers",
      "- [ ] file the tax",
      "- [ ] wire up the pane ⏫ #kasten",
      "- [ ] ship it #kasten",
      "- [ ] call the dentist ⏫",
      "- [ ] see (#next)",
      "",
    ].join("\n"),
  });
  // This note's rows by the place of each todo in it, read in one evaluate (#1937) and sorted,
  // since a priority leads the list.
  // The vault's other todos do not count.
  const lines = () =>
    page.evaluate((prefix) => {
      const rows = document.querySelectorAll<HTMLElement>(`[data-row^="${prefix}"]`);
      return [...rows]
        .map((row) => Number(row.dataset.row?.slice(prefix.length)))
        .sort((a, b) => a - b);
    }, `${note}:`);
  await openApp(page);
  await leader(page, "gt");
  await expect.poll(lines).toEqual([1, 2, 3, 4, 5, 6, 7]);
  const filter = page.getByLabel("filter todos");
  await filter.fill("#client");
  await expect.poll(lines).toEqual([1, 2]);
  await filter.fill("-#client");
  await expect.poll(lines).toEqual([3, 4, 5, 6, 7]);
  // `#kasten` alone keeps ship it, `!high` alone the dentist: across groups the terms are an and.
  await filter.fill("#kasten !high");
  await expect.poll(lines).toEqual([4]);
  await filter.fill("#next");
  await expect.poll(lines).toEqual([7]);
});

const SPEC = "02 Projects/Spec.md";

/**
 * Opens the todo pane with two rows done today in its open fold and pauses the clock, so the
 * press's 1 s hold lets go only as far as `waitFor` runs it.
 */
async function openFold(page: Page, vault: string): Promise<() => void> {
  const done = `✅ ${today()}`;
  await vaultWith(vault, {
    [SPEC]: `# Spec\n\n- [x] read the spec ${done}\n- [x] write the spec ${done}\n`,
  });
  await page.clock.install();
  await openApp(page);
  await leader(page, "gt");
  await page.getByRole("button", { name: /^Done this week/ }).click();
  await expect(page.locator(TODO_ROW, { hasText: "read the spec" })).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  let ran = 0;
  return () => {
    // Every wait after the first press shares one budget under the hold's 1 s.
    expect(ran, "the clock ran past the press's hold").toBeLessThan(900);
    ran += 20;
  };
}

/** Runs the paused clock in short steps until `drawn` holds, within the hold's budget. */
async function waitFor(page: Page, spend: () => void, drawn: () => Promise<boolean>) {
  await expect
    .poll(
      async () => {
        spend();
        await page.clock.runFor(20);
        return drawn();
      },
      { intervals: [20] },
    )
    .toBe(true);
}

const listed = async (page: Page, words: string) =>
  (await todoRows(page)).texts.some((text) => text.includes(words));

/** The nth marker note, one todo in it: a note written again would import its lines a second time. */
const marker = (n: number) => `02 Projects/Marker ${n}.md`;

test("in the open fold, a second x after the first reopened a done row acts on that row (#2001)", async ({
  page,
  stack,
}) => {
  const spend = await openFold(page, stack.vault);
  await cursorTo(page, "read the spec");
  await page.keyboard.press("x");
  await expect.poll(() => store(stack.url)).toMatch(/^- \[ \] read the spec/m);
  // A done row in another note: its row drawn means an answer later than the write has drawn.
  await vaultWith(stack.vault, { [marker(1)]: `- [x] ship it ✅ ${today()}\n` });
  await waitFor(page, spend, () => listed(page, "ship it"));
  await page.keyboard.press("x");
  await expect.poll(() => store(stack.url)).toMatch(/^- \[\/\] read the spec/m);
  // Open again, the row leaves the fold for its group; a third x still follows it there.
  await vaultWith(stack.vault, { [marker(2)]: `- [x] ship more ✅ ${today()}\n` });
  await waitFor(page, spend, () => listed(page, "ship more"));
  await page.keyboard.press("x");
  await expect.poll(() => store(stack.url)).toMatch(/^- \[x\] read the spec/m);
  expect(await store(stack.url)).toMatch(/^- \[x\] write the spec/m);
});

test("in the open fold, a new open row drawn while the press holds leaves the cursor on its fold row (#2001)", async ({
  page,
  stack,
}) => {
  const spend = await openFold(page, stack.vault);
  await cursorTo(page, "read the spec");
  await page.keyboard.press("x");
  await expect.poll(() => store(stack.url)).toMatch(/^- \[ \] read the spec/m);
  // The new open row joins a group above the fold, which pushes every fold row down one.
  await vaultWith(stack.vault, { [marker(1)]: "- [ ] call the plumber\n" });
  await waitFor(page, spend, () => listed(page, "call the plumber"));
  await page.keyboard.press("x");
  await expect.poll(() => store(stack.url)).toMatch(/^- \[\/\] read the spec/m);
  expect(await store(stack.url)).toMatch(/^- \[ \] call the plumber /m);
});

test("an open row checked off while the fold is open and the press holds is drawn once", async ({
  page,
  stack,
}) => {
  const spend = await openFold(page, stack.vault);
  await cursorTo(page, "water the tomatoes");
  await page.keyboard.press("X");
  await expect.poll(() => store(stack.url)).toMatch(/^- \[x\] water the tomatoes/m);
  await vaultWith(stack.vault, { [marker(1)]: "- [ ] call the plumber\n" });
  await waitFor(page, spend, () => listed(page, "call the plumber"));
  const rows = (await todoRows(page)).texts.filter((text) => text.includes("water the tomatoes"));
  expect(rows).toHaveLength(1);
});

test("the legend is drawn on the open list, and not on d's or n's", async ({ page }) => {
  await openApp(page);
  await leader(page, "gt");
  const legend = page.getByRole("list", { name: "legend" });
  await expect(legend).toBeVisible();
  await page.keyboard.press("d");
  await expect(page.getByRole("button", { name: "done", pressed: true })).toBeVisible();
  await expect(legend).toHaveCount(0);
  await page.keyboard.press("n");
  await expect(page.getByRole("button", { name: "next", pressed: true })).toBeVisible();
  await expect(legend).toHaveCount(0);
});

const PLAN = "02 Projects/Plan.md";
/** Each press's line in the store, from an open todo round the cycle to done. */
const ROUND = [/^- \[\/\] read the plan/m, /^- \[x\] read the plan/m];
const REOPENED = /^- \[ \] read the plan /m;

/**
 * Opens the todo pane on two open rows of a note, and pauses the clock so the press's 1 s hold
 * lets go only as far as it runs.
 */
async function openPlan(page: Page, vault: string, open: () => Promise<void>) {
  await vaultWith(vault, {
    [PLAN]: "# Plan\n\n- [ ] read the plan\n- [ ] write the plan\n",
  });
  await page.clock.install();
  await open();
  await expect(page.locator(TODO_ROW, { hasText: "read the plan" })).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  return doneCount(page);
}

/** The count on the Done this week heading, which is not drawn while the week has none. */
async function doneCount(page: Page): Promise<number> {
  const fold = page.getByRole("button", { name: /^Done this week/ });
  if ((await fold.count()) === 0) return 0;
  return Number((await fold.textContent())?.match(/\d+$/)?.[0]);
}

/**
 * Adds the nth done row to another note and runs the clock, inside the hold, until an answer later
 * than the write counts it. A done row joins the folded fold, so the held open order stays as it was.
 */
async function drawnAfter(page: Page, vault: string, n: number, base: number, spend: () => void) {
  await vaultWith(vault, { [marker(n)]: `- [x] mark ${n} ✅ ${today()}\n` });
  await waitFor(page, spend, async () => (await doneCount(page)) === base + n);
}

/** One press's share of the clock: each press starts the 1 s hold again. */
function holdBudget(): () => void {
  let ran = 0;
  return () => {
    expect(ran, "the clock ran past the press's hold").toBeLessThan(900);
    ran += 20;
  };
}

test("in an open group, an x after the one that made a row done cycles that row back to open (#2003)", async ({
  page,
  stack,
}) => {
  const base = await openPlan(page, stack.vault, async () => {
    await openApp(page);
    await leader(page, "gt");
  });
  await cursorTo(page, "read the plan");
  for (const [step, line] of ROUND.entries()) {
    await page.keyboard.press("x");
    await expect.poll(() => store(stack.url)).toMatch(line);
    await drawnAfter(page, stack.vault, step + 1, base, holdBudget());
  }
  // Done in the store, the row stays in its place, struck, under the cursor.
  const cursor = page.locator(`${TODO_ROW}[tabindex="0"]`);
  await expect(cursor).toContainText("read the plan");
  await expect(cursor.locator(".line-through")).toBeVisible();
  await page.keyboard.press("x");
  await expect.poll(() => store(stack.url)).toMatch(REOPENED);
  expect(await store(stack.url)).toMatch(/^- \[ \] write the plan /m);
});

test("once the hold lets go, a row made done leaves its open group (#2003)", async ({
  page,
  stack,
}) => {
  const base = await openPlan(page, stack.vault, async () => {
    await openApp(page);
    await leader(page, "gt");
  });
  await cursorTo(page, "read the plan");
  for (const [step, line] of ROUND.entries()) {
    await page.keyboard.press("x");
    await expect.poll(() => store(stack.url)).toMatch(line);
    await drawnAfter(page, stack.vault, step + 1, base, holdBudget());
  }
  await expect(page.locator(TODO_ROW, { hasText: "read the plan" })).toBeVisible();
  await page.clock.runFor(1500);
  await expect(page.locator(TODO_ROW, { hasText: "read the plan" })).toHaveCount(0);
  await expect(page.locator(TODO_ROW, { hasText: "write the plan" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("two taps on the box of a row made done cycle that row back to open (#2003)", async ({
    page,
    stack,
  }) => {
    const base = await openPlan(page, stack.vault, async () => {
      // A write goes by the file list, and a note it lacks is created, which a held note refuses.
      const files = page.waitForResponse((answer) => answer.url().endsWith("/api/files"));
      await page.goto("/");
      await files;
      await page.getByRole("button", { name: "Open the todo pane" }).tap();
    });
    // The first tap asks, the second cycles.
    const box = page.getByRole("button", { name: "cycle read the plan" });
    for (const [step, line] of ROUND.entries()) {
      await box.tap();
      await box.tap();
      // A tap's write waits on the clock, so the clock runs while the note is read.
      const spend = holdBudget();
      await waitFor(page, spend, async () => line.test(await store(stack.url)));
      await drawnAfter(page, stack.vault, step + 1, base, spend);
    }
    await expect(
      page.locator(TODO_ROW, { hasText: "read the plan" }).locator(".line-through"),
    ).toBeVisible();
    await box.tap();
    await box.tap();
    const spend = holdBudget();
    await waitFor(page, spend, async () => REOPENED.test(await store(stack.url)));
    expect(await store(stack.url)).toMatch(/^- \[ \] write the plan /m);
  });

  test("tapping a todo's more strip and done checks it off in the store", async ({
    page,
    stack,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap();
    await page.getByRole("button", { name: "more for fold the laundry" }).tap();
    await page.getByRole("button", { name: "done fold the laundry" }).tap();
    await expect
      .poll(() => store(stack.url), { timeout: 15_000 })
      .toMatch(/^- \[x\] fold the laundry/m);
  });
});
