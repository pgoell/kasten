import type { Page } from "@playwright/test";
import {
  bodyOf,
  cursorTo,
  leader,
  noteText,
  openApp,
  phone,
  plus,
  TODO_ROW,
  today,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const PLAN = "02 Projects/FDE/plan.md";
const ERRANDS = "01 Notes/Errands.md";
const FDE = "02 Projects/FDE/index.md";
const PLAN_LINES = `# Plan\n\n- [ ] write the deck #internal\n  - [/] draw the chart\n  - [x] gather numbers ✅ ${plus(-1)}\n`;
// The invoice files under FDE by its link; the tap names no project.
const SEND = "- [ ] send the invoice [[02 Projects/FDE/index|FDE]] #client";
const ERRAND_LINES = `# Errands\n\n${SEND}\n- [b] ship it\n- [ ] fix the tap\n- [-] drop the logo ❌ ${today()}\n`;
const disk = (vault: string, path: string) => noteText(vault, path).then(bodyOf);
const card = (page: Page, words: string) => page.locator("[data-card]", { hasText: words });
const cursorCard = (page: Page) => page.locator('[data-card][tabindex="0"]');
const shown = (page: Page) => page.locator("[data-card]:visible");
const strip = (page: Page, label: string, words: string) =>
  page.getByRole("button", { name: new RegExp(`^${label} ${words}`) });
const footer = (page: Page) => page.getByTestId("todo-footer");

/** Writes the two notes and the two project notes, and records each note write sent from here on. */
async function notes(page: Page, vault: string): Promise<string[]> {
  await vaultWith(vault, {
    [PLAN]: PLAN_LINES,
    [ERRANDS]: ERRAND_LINES,
    [FDE]: "# FDE\n",
    "02 Projects/Kasten/index.md": "# Kasten\n",
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT"].includes(request.method()) && request.url().includes("/api/files/"))
      writes.push(request.url());
  });
  return writes;
}

/** The todo pane by touch, as a list or as the board once its cards are drawn. */
async function byTouch(page: Page, vault: string, board = true): Promise<string[]> {
  const writes = await notes(page, vault);
  await page.goto("/");
  await page.getByRole("button", { name: "Open the todo pane" }).tap({ timeout: 15_000 });
  await expect(page.locator(TODO_ROW, { hasText: "fix the tap" })).toBeVisible();
  if (!board) return writes;
  await page.getByRole("button", { name: "board", exact: true }).tap();
  await expect(card(page, "fix the tap")).toBeVisible();
  return writes;
}

/** Both refile notes as the vault holds them. */
const refiled = async (vault: string) => [await disk(vault, FDE), await disk(vault, ERRANDS)];
const MOVED = [
  `# FDE\n\n## TODOs\n${SEND}\n`,
  ERRAND_LINES.replace(SEND, "- send the invoice [[02 Projects/FDE/index|FDE]] #client"),
];

test.describe("on a phone", () => {
  test.use(phone);

  test("A10 the board shows one state at a time, a tab per state counting its cards, and a strip of every state, project and refile under a card", async ({
    page,
    stack,
  }) => {
    await byTouch(page, stack.vault);
    const tabs = page.getByRole("tab", { name: / \d+$/ });
    const names = await tabs.allTextContents();
    expect(names.map((name) => name.replace(/ \d+$/, ""))).toEqual([
      "Open",
      "Doing",
      "Review",
      "Waiting",
      "Blocked",
      "Done",
      "Rejected",
    ]);
    // Each tab's count is the cards it shows, the e2e vault's own todos among them.
    for (const name of names) {
      await page.getByRole("tab", { name, exact: true }).tap();
      await expect(shown(page)).toHaveCount(Number(name.split(" ").at(-1)));
    }
    await page.getByRole("tab", { name: /^Done / }).tap();
    await expect(shown(page)).toContainText(["gather numbers"]);

    await page.getByRole("button", { name: "more for gather numbers" }).tap();
    for (const label of ["open", "doing", "review", "done", "blocked", "waiting", "rejected"])
      await expect(strip(page, label, "gather numbers")).toBeVisible();
    await expect(strip(page, "refile", "gather numbers")).toBeVisible();
    await strip(page, "project", "gather numbers").tap();
    await expect(page.getByTestId("todo-project-pick").getByRole("button")).toHaveText([
      "cancel",
      "FDE",
      "Kasten",
    ]);
  });

  test("I8 a state tapped on the strip moves the card on one tap, and Enter on a focused strip button does the same and opens no note", async ({
    page,
    stack,
  }) => {
    const writes = await byTouch(page, stack.vault);
    // Off the cycle's path, so a state cycled rather than set would land elsewhere.
    await page.getByRole("button", { name: "more for fix the tap" }).tap();
    await strip(page, "done", "fix the tap").tap();
    await expect
      .poll(() => disk(stack.vault, ERRANDS))
      .toContain(`- [x] fix the tap ✅ ${today()}`);
    await page.getByRole("tab", { name: /^Done / }).tap();
    await expect(shown(page)).toContainText(["fix the tap"]);
    expect(writes.filter((url) => url.endsWith("Errands.md"))).toHaveLength(1);

    await page.getByRole("tab", { name: /^Doing / }).tap();
    await page.getByRole("button", { name: "more for draw the chart" }).tap();
    await strip(page, "review", "draw the chart").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => disk(stack.vault, PLAN)).toContain("  - [r] draw the chart\n");
    await expect(page.locator(".cm-activeLine")).toHaveCount(0);
    expect(writes.filter((url) => url.endsWith("plan.md"))).toHaveLength(1);
  });

  test("B4 cancel shuts the project picker, writes nothing and hands the focus back to the card under the cursor", async ({
    page,
    stack,
  }) => {
    const writes = await byTouch(page, stack.vault);
    await page.getByRole("button", { name: "more for fix the tap" }).tap();
    await strip(page, "project", "fix the tap").tap();
    const cancel = page.getByRole("button", { name: "cancel" });
    await cancel.focus();
    await cancel.tap();
    await expect(page.getByTestId("todo-project-pick")).toHaveCount(0);
    await expect(cursorCard(page)).toBeFocused();
    // A later write queues behind any the cancel sent, so the note then shows both or this alone.
    await page.getByRole("button", { name: "more for fix the tap" }).tap();
    await strip(page, "doing", "fix the tap").tap();
    await expect
      .poll(() => disk(stack.vault, ERRANDS))
      .toBe(ERRAND_LINES.replace("- [ ] fix the tap", "- [/] fix the tap"));
    expect(writes).toHaveLength(1);
  });

  test("#773 Enter on a focused ⋯ opens its strip and not the cursor card's note, and Space on a focused tab shows that state", async ({
    page,
    stack,
  }) => {
    await byTouch(page, stack.vault);
    await expect(cursorCard(page)).not.toContainText("fix the tap");
    await page.getByRole("button", { name: "more for fix the tap" }).focus();
    await page.keyboard.press("Enter");
    await expect(strip(page, "done", "fix the tap")).toBeVisible();
    await expect(page.locator(".cm-activeLine")).toHaveCount(0);

    await page.getByRole("tab", { name: "Doing 1" }).focus();
    await page.keyboard.press(" ");
    await expect(shown(page)).toHaveText([/draw the chart$/]);
  });

  test("#488 the board's and the list's footers drop their key hints", async ({ page, stack }) => {
    await byTouch(page, stack.vault, false);
    await expect(footer(page)).toBeVisible();
    await expect(footer(page)).not.toContainText("x cycle");
    await page.getByRole("button", { name: "board", exact: true }).tap();
    await expect(card(page, "fix the tap")).toBeVisible();
    await expect(footer(page)).toBeVisible();
    await expect(footer(page)).not.toContainText("h l column");
  });

  test("#396 A4 refile on a card's strip moves that todo into its project's note", async ({
    page,
    stack,
  }) => {
    await byTouch(page, stack.vault);
    await page.getByRole("button", { name: "more for send the invoice" }).tap();
    await strip(page, "refile", "send the invoice").tap();
    await expect.poll(() => refiled(stack.vault)).toEqual(MOVED);
  });
});

/** The todo pane by keys, with vim on by its leader and off by the palette. */
async function byKeys(page: Page, vault: string, vim: string): Promise<string[]> {
  const writes = await notes(page, vault);
  if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await openApp(page);
  if (vim === "on") await leader(page, "gt");
  else {
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
  }
  await expect(page.locator(TODO_ROW, { hasText: "fix the tap" })).toBeVisible();
  return writes;
}

for (const vim of ["on", "off"]) {
  test.describe(`with vim ${vim}`, () => {
    test(`#396 m on a list row moves that one row into its project's note`, async ({
      page,
      stack,
    }) => {
      await byKeys(page, stack.vault, vim);
      await cursorTo(page, "send the invoice");
      await page.keyboard.press("m");
      await expect.poll(() => refiled(stack.vault)).toEqual(MOVED);
    });

    test(`#396 m on a board card hands on that card, not the one first in the lane`, async ({
      page,
      stack,
    }) => {
      const writes = await byKeys(page, stack.vault, vim);
      await page.keyboard.press("c");
      await expect(card(page, "fix the tap")).toBeVisible();
      for (
        let i = 0;
        i < 20 && !(await cursorCard(page).textContent())?.includes("fix the tap");
        i++
      )
        await page.keyboard.press("j");
      await expect(cursorCard(page)).toContainText("fix the tap");
      await page.keyboard.press("m");
      await expect(page.getByTestId("notice")).toHaveText(
        "That todo has no project: give it one with p or a #p/x tag",
      );
      expect([writes, await refiled(stack.vault)]).toEqual([[], ["# FDE\n", ERRAND_LINES]]);
    });
  });
}

test("#396 A1 #488 on a desktop the list's footer names m refile, and the board's names m refile and h l column", async ({
  page,
  stack,
}) => {
  await byKeys(page, stack.vault, "on");
  await expect(footer(page)).toContainText("m refile");
  await page.keyboard.press("c");
  await expect(card(page, "fix the tap")).toBeVisible();
  await expect(footer(page)).toContainText("m refile");
  await expect(footer(page)).toContainText("h l column");
});

const cycle = (page: Page, words: string) =>
  page.getByRole("button", { name: `cycle ${words}`, exact: true });
const more = (page: Page, words: string) =>
  page.getByRole("button", { name: `more for ${words}`, exact: true });
const lineOf = async (vault: string, path: string, words: string) =>
  (await disk(vault, path)).split("\n").find((line) => line.includes(words));
const STATES = ["open", "doing", "review", "done", "blocked", "waiting", "rejected"];

/** Whether the row's state button asks: a ? over the state the next tap leaves. */
async function asks(page: Page, words: string, next?: string): Promise<void> {
  await expect(cycle(page, words)).toHaveAttribute("aria-pressed", "true");
  await expect(cycle(page, words)).toHaveText("?");
  if (next) await expect(cycle(page, words).locator(`svg[data-state="${next}"]`)).toHaveCount(1);
}

async function quiet(page: Page, words: string): Promise<void> {
  await expect(cycle(page, words)).toHaveAttribute("aria-pressed", "false");
  await expect(cycle(page, words)).not.toHaveText("?");
}

test.describe("the list's state button by touch", () => {
  test.use(phone);

  test("the first tap asks with the state it leaves and a ?, writing nothing; the second walks the row, a review row to done, and opens no note", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "01 Notes/Parser.md": "- [r] write the parser\n" });
    const writes = await byTouch(page, stack.vault, false);
    // Done also logs into today's note; the count is of the todos' own notes.
    const notes = () => writes.filter((url) => !url.includes("Daily"));
    const rows = [
      ["fix the tap", "doing", ERRANDS, "- [/] fix the tap"],
      ["write the parser", "done", "01 Notes/Parser.md", "- [x] write the parser"],
    ];
    for (const [n, [words, next, path, walked]] of rows.entries()) {
      await cycle(page, words).tap();
      await asks(page, words, next);
      expect(notes()).toHaveLength(n);
      await cycle(page, words).tap();
      await expect.poll(() => lineOf(stack.vault, path, words)).toContain(walked);
      expect(notes()).toHaveLength(n + 1);
    }
    await expect(page.locator(".cm-content:visible")).toHaveCount(0);
  });

  test("the strip names the states in the order of the shifted keys, and a tap on each sets it on the one tap and shuts the strip", async ({
    page,
    stack,
  }) => {
    const writes = await byTouch(page, stack.vault, false);
    await more(page, "fix the tap").tap();
    const labels = await page
      .locator('[aria-label$=" fix the tap"]')
      .evaluateAll((all) => all.map((button) => button.getAttribute("aria-label")));
    const named = STATES.map((one) => `${one} fix the tap`);
    expect(labels.filter((label) => named.includes(label ?? ""))).toEqual(named);
    await more(page, "fix the tap").tap();

    const marks = { doing: "/", review: "r", blocked: "b", waiting: "w", open: " ", done: "x" };
    const sets = Object.entries(marks).map(([one, mark]) => [one, mark, "fix the tap"]);
    for (const [n, [one, mark, words]] of [...sets, ["rejected", "-", "ship it"]].entries()) {
      await more(page, words).tap();
      await strip(page, one, words).tap();
      await expect(strip(page, one, words)).toHaveCount(0);
      await expect
        .poll(() => lineOf(stack.vault, ERRANDS, words))
        .toContain(`- [${mark}] ${words}`);
      expect(writes.filter((url) => url.endsWith("Errands.md"))).toHaveLength(n + 1);
    }
  });

  test("a question lasts for one row: another row's first tap moves it, a strip opening takes it back, and a state tapped shuts an open strip", async ({
    page,
    stack,
  }) => {
    const writes = await byTouch(page, stack.vault, false);
    await cycle(page, "fix the tap").tap();
    await cycle(page, "ship it").tap();
    await asks(page, "ship it");
    await quiet(page, "fix the tap");
    for (const other of ["ship it", "fix the tap"]) {
      await cycle(page, "fix the tap").tap();
      await asks(page, "fix the tap");
      await more(page, other).tap();
      await quiet(page, "fix the tap");
      await more(page, other).tap();
    }
    await more(page, "fix the tap").tap();
    await cycle(page, "ship it").tap();
    await asks(page, "ship it");
    await expect(more(page, "fix the tap")).toHaveAttribute("aria-expanded", "false");
    await expect(strip(page, "done", "fix the tap")).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test("a tap elsewhere takes the question back, and a tap on a row then opens its note, writing nothing", async ({
    page,
    stack,
  }) => {
    const writes = await byTouch(page, stack.vault, false);
    await cycle(page, "fix the tap").tap();
    await footer(page).tap();
    await quiet(page, "fix the tap");
    await cycle(page, "fix the tap").tap();
    await asks(page, "fix the tap");
    await page.locator(TODO_ROW, { hasText: "ship it" }).tap();
    await expect(page.locator(".cm-activeLine:visible")).toHaveText("- [b] ship it");
    expect(writes).toEqual([]);
  });

  test("a scroll of the list or four seconds take the question back, and the tap after asks again", async ({
    page,
    stack,
  }) => {
    const fill = Array.from({ length: 30 }, (_, n) => `- [ ] filler ${n}\n`).join("");
    await vaultWith(stack.vault, { "01 Notes/Filler.md": fill });
    await page.clock.install();
    const writes = await byTouch(page, stack.vault, false);
    await cycle(page, "fix the tap").tap();
    await asks(page, "fix the tap");
    await page
      .locator(TODO_ROW)
      .first()
      .evaluate((row) => {
        for (let at = row.parentElement; at; at = at.parentElement)
          if (at.scrollHeight > at.clientHeight + 50) return at.scrollBy(0, 50);
      });
    await quiet(page, "fix the tap");
    // Paused, so only runFor moves the four seconds and no real time slips in.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await cycle(page, "fix the tap").tap();
    await asks(page, "fix the tap");
    await page.clock.runFor(3999);
    await asks(page, "fix the tap");
    await page.clock.runFor(1);
    await quiet(page, "fix the tap");
    await cycle(page, "fix the tap").tap();
    await asks(page, "fix the tap");
    expect(writes).toEqual([]);
  });

  test("neither a question nor an open strip carries onto another todo a write puts on the line", async ({
    page,
    stack,
  }) => {
    const writes = await byTouch(page, stack.vault, false);
    await more(page, "fix the tap").tap();
    await expect(strip(page, "done", "fix the tap")).toBeVisible();
    await vaultWith(stack.vault, {
      [ERRANDS]: ERRAND_LINES.replace("fix the tap", "feed the cat"),
    });
    // The vault's own watcher brings the write in, as slow as under load as any disk write.
    await expect(more(page, "feed the cat")).toHaveAttribute("aria-expanded", "false", {
      timeout: 15_000,
    });
    await expect(strip(page, "done", "feed the cat")).toHaveCount(0);

    await cycle(page, "feed the cat").tap();
    await asks(page, "feed the cat");
    await vaultWith(stack.vault, {
      [ERRANDS]: ERRAND_LINES.replace("fix the tap", "mend the gate"),
    });
    await expect(cycle(page, "mend the gate")).toBeVisible({ timeout: 15_000 });
    await quiet(page, "mend the gate");
    await expect(cycle(page, "mend the gate").locator('svg[data-state="open"]')).toHaveCount(1);
    await cycle(page, "mend the gate").tap();
    await asks(page, "mend the gate");
    expect(writes).toEqual([]);
  });
});
