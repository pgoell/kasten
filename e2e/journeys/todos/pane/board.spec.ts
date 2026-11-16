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
    await page.getByRole("tab", { name: "Doing 1" }).tap();
    await page.getByRole("button", { name: "more for draw the chart" }).tap();
    await strip(page, "done", "draw the chart").tap();
    await expect
      .poll(() => disk(stack.vault, PLAN))
      .toContain(`  - [x] draw the chart ✅ ${today()}`);
    await page.getByRole("tab", { name: /^Done / }).tap();
    await expect(shown(page)).toContainText(["draw the chart"]);
    expect(writes.filter((url) => url.endsWith("plan.md"))).toHaveLength(1);

    await page.getByRole("tab", { name: /^Open / }).tap();
    await page.getByRole("button", { name: "more for write the deck" }).tap();
    await strip(page, "doing", "write the deck").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => disk(stack.vault, PLAN)).toContain("- [/] write the deck #internal");
    await expect(page.locator(".cm-activeLine")).toHaveCount(0);
    expect(writes.filter((url) => url.endsWith("plan.md"))).toHaveLength(2);
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
    expect([writes, await disk(stack.vault, ERRANDS)]).toEqual([[], ERRAND_LINES]);
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
