import type { Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cursorTo,
  leader,
  noteText,
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
    .poll(() => noteText(stack.vault, HOME), { timeout: 15_000 })
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
  // This note's rows by line, read in one evaluate (#1937) and sorted, since a priority leads the list.
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
  await expect.poll(lines).toEqual([3, 4, 5, 6, 7, 8, 9]);
  const filter = page.getByLabel("filter todos");
  await filter.fill("#client");
  await expect.poll(lines).toEqual([3, 4]);
  await filter.fill("-#client");
  await expect.poll(lines).toEqual([5, 6, 7, 8, 9]);
  // `#kasten` alone keeps ship it, `!high` alone the dentist: across groups the terms are an and.
  await filter.fill("#kasten !high");
  await expect.poll(lines).toEqual([6]);
  await filter.fill("#next");
  await expect.poll(lines).toEqual([9]);
});

const SPEC = "02 Projects/Spec.md";
const MARKER = "02 Projects/Marker.md";

/**
 * Opens the todo pane with two rows done today in its open fold and pauses the clock, so the
 * press's 1 s hold lets go only as far as `waitFor` runs it.
 */
async function openFold(page: Page, vault: string): Promise<() => void> {
  const done = `✅ ${today()}`;
  // No frontmatter, as the issue's note: the first save stamps a block and moves every line down.
  await vaultWith(vault, { [SPEC]: `# Spec\n\n- [x] read the spec ${done}\n- [x] write the spec ${done}\n` });
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
    .poll(async () => {
      spend();
      await page.clock.runFor(20);
      return drawn();
    }, { intervals: [20] })
    .toBe(true);
}

const listed = async (page: Page, words: string) =>
  (await todoRows(page)).texts.some((text) => text.includes(words));

test("in the open fold, a second x after the first made a done row plain words acts on that row (#2001)", async ({
  page,
  stack,
}) => {
  const spend = await openFold(page, stack.vault);
  await cursorTo(page, "read the spec");
  await page.keyboard.press("x");
  await expect.poll(() => noteText(stack.vault, SPEC)).toMatch(/^read the spec$/m);
  // A done row in another note: its row drawn means an answer later than the write has drawn.
  await vaultWith(stack.vault, { [MARKER]: `- [x] ship it ✅ ${today()}\n` });
  await waitFor(page, spend, () => listed(page, "ship it"));
  await page.keyboard.press("x");
  await expect.poll(() => noteText(stack.vault, SPEC)).toMatch(/^- \[ \] read the spec( ➕ \S+)?$/m);
  // Open again, the row leaves the fold for its group; a third x still follows it there.
  await vaultWith(stack.vault, { [MARKER]: `- [x] ship it ✅ ${today()}\n- [x] ship more ✅ ${today()}\n` });
  await waitFor(page, spend, () => listed(page, "ship more"));
  await page.keyboard.press("x");
  await expect.poll(() => noteText(stack.vault, SPEC)).toMatch(/^- \[\/\] read the spec/m);
  expect(await noteText(stack.vault, SPEC)).toMatch(/^- \[x\] write the spec/m);
});

test("in the open fold, a new open row drawn while the press holds leaves the cursor on its fold row (#2001)", async ({
  page,
  stack,
}) => {
  const spend = await openFold(page, stack.vault);
  await cursorTo(page, "read the spec");
  await page.keyboard.press("x");
  await expect.poll(() => noteText(stack.vault, SPEC)).toMatch(/^read the spec$/m);
  // The new open row joins a group above the fold, which pushes every fold row down one.
  await vaultWith(stack.vault, { [MARKER]: "- [ ] call the plumber\n" });
  await waitFor(page, spend, () => listed(page, "call the plumber"));
  await page.keyboard.press("x");
  await expect.poll(() => noteText(stack.vault, SPEC)).toMatch(/^- \[ \] read the spec( ➕ \S+)?$/m);
  expect(await noteText(stack.vault, MARKER)).toBe("- [ ] call the plumber\n");
});

test("an open row checked off while the fold is open and the press holds is drawn once", async ({
  page,
  stack,
}) => {
  const spend = await openFold(page, stack.vault);
  await cursorTo(page, "water the tomatoes");
  await page.keyboard.press("X");
  await expect
    .poll(() => noteText(stack.vault, "02 Projects/Garden.md"))
    .toMatch(/^- \[x\] water the tomatoes/m);
  await vaultWith(stack.vault, { [MARKER]: "- [ ] call the plumber\n" });
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
/** Each press's line on disk, from an open todo round the cycle to plain words. */
const ROUND = [/^- \[\/\] read the plan/m, /^- \[x\] read the plan/m, /^read the plan( 🆔 \S+)?$/m];

/**
 * Opens the todo pane on two open rows of a note with no frontmatter, so the first save stamps a
 * block over them, and pauses the clock so the press's 1 s hold lets go only as far as it runs.
 */
async function openPlan(page: Page, vault: string, open: () => Promise<void>) {
  await vaultWith(vault, {
    [PLAN]: "# Plan\n\n- [ ] read the plan\n- [ ] write the plan\n",
  });
  await page.clock.install();
  await open();
  await expect(page.locator(TODO_ROW, { hasText: "read the plan" })).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
}

/** Adds the nth open row to another note and runs the clock, inside the hold, until an answer later than the write draws it. */
async function drawnAfter(page: Page, vault: string, n: number, spend: () => void) {
  await vaultWith(vault, {
    [MARKER]: Array.from({ length: n }, (_, i) => `- [ ] mark ${i + 1}\n`).join(""),
  });
  await waitFor(page, spend, () => listed(page, `mark ${n}`));
}

/** One press's share of the clock: each press starts the 1 s hold again. */
function holdBudget(): () => void {
  let ran = 0;
  return () => {
    expect(ran, "the clock ran past the press's hold").toBeLessThan(900);
    ran += 20;
  };
}

test("in an open group, an x after the one that made a row plain words cycles that row back to open (#2003)", async ({
  page,
  stack,
}) => {
  await openPlan(page, stack.vault, async () => {
    await openApp(page);
    await leader(page, "gt");
  });
  await cursorTo(page, "read the plan");
  for (const [step, line] of ROUND.entries()) {
    await page.keyboard.press("x");
    await expect.poll(() => noteText(stack.vault, PLAN)).toMatch(line);
    await drawnAfter(page, stack.vault, step + 1, holdBudget());
  }
  // Plain words on disk, the row stays in its place, struck, under the cursor.
  const cursor = page.locator(`${TODO_ROW}[tabindex="0"]`);
  await expect(cursor).toContainText("read the plan");
  await expect(cursor.locator(".line-through")).toBeVisible();
  await page.keyboard.press("x");
  await expect.poll(() => noteText(stack.vault, PLAN)).toMatch(/^- \[ \] read the plan\b/m);
  expect(await noteText(stack.vault, PLAN)).toMatch(/^- \[ \] write the plan$/m);
});

test("once the hold lets go, a row made plain words leaves its open group (#2003)", async ({
  page,
  stack,
}) => {
  await openPlan(page, stack.vault, async () => {
    await openApp(page);
    await leader(page, "gt");
  });
  await cursorTo(page, "read the plan");
  for (const [step, line] of ROUND.entries()) {
    await page.keyboard.press("x");
    await expect.poll(() => noteText(stack.vault, PLAN)).toMatch(line);
    await drawnAfter(page, stack.vault, step + 1, holdBudget());
  }
  await expect(page.locator(TODO_ROW, { hasText: "read the plan" })).toBeVisible();
  await page.clock.runFor(1500);
  await expect(page.locator(TODO_ROW, { hasText: "read the plan" })).toHaveCount(0);
  await expect(page.locator(TODO_ROW, { hasText: "write the plan" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("two taps on the box of a row made plain words cycle that row back to open (#2003)", async ({
    page,
    stack,
  }) => {
    await openPlan(page, stack.vault, async () => {
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
      await waitFor(page, spend, async () => line.test(await noteText(stack.vault, PLAN)));
      await drawnAfter(page, stack.vault, step + 1, spend);
    }
    await expect(
      page.locator(TODO_ROW, { hasText: "read the plan" }).locator(".line-through"),
    ).toBeVisible();
    await box.tap();
    await box.tap();
    const spend = holdBudget();
    await waitFor(page, spend, async () =>
      /^- \[ \] read the plan\b/m.test(await noteText(stack.vault, PLAN)),
    );
    expect(await noteText(stack.vault, PLAN)).toMatch(/^- \[ \] write the plan$/m);
  });

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
