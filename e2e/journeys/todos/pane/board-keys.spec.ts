import type { Page } from "@playwright/test";
import {
  atDrop,
  bodyOf,
  leader,
  noteText,
  openApp,
  plus,
  today,
  vaultWith,
  watchDrop,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const PLAN = "02 Projects/FDE/plan.md";
const DAILY = `01 Periodic/00 Daily/${today()}.md`;
const DECK = `- [ ] write the deck 📅 ${plus(2)} ⏫ #internal`;
const PLAN_LINES = `${DECK}\n  - [/] draw the chart\n  - [x] gather numbers ✅ ${plus(-1)}\n`;
// One line a kind: the invoice is client work filed under FDE by its link, the tap names nothing.
const DAILY_LINES = [
  "# Today",
  "- [ ] send the invoice [[02 Projects/FDE/index|FDE]] #client",
  "- [b] ship it ⛔ kt-000009 #private",
  "- [ ] fix the tap 🆔 kt-000009",
  `- [-] old idea ❌ ${plus(-16)}`,
  `- [-] drop the logo ❌ ${plus(-1)}`,
].join("\n");
const KASTEN = "[[02 Projects/Kasten/index|Kasten]]";
// The fixture's own todos, written over so the board holds these cards alone.
const QUIET = { "02 Projects/Garden.md": "# Garden\n", "02 Projects/Home.md": "# Home\n" };

const card = (page: Page, words: string) => page.locator("[data-card]", { hasText: words });
const cursor = (page: Page) => page.locator('[data-card][tabindex="0"]');
const shown = (page: Page) => page.locator("[data-card]:visible");
const picker = (page: Page) => page.getByTestId("todo-project-pick");
const filter = (page: Page) => page.getByLabel("filter todos");
const region = (page: Page) => page.getByRole("region", { name: "Todos" });
const caretLine = (page: Page) => page.locator(".cm-activeLine");
const lineOf = async (vault: string, path: string, words: string) =>
  bodyOf(await noteText(vault, path))
    .split("\n")
    .find((line) => line.includes(words));
const focused = (page: Page) =>
  page.evaluate(() => {
    const at = document.activeElement as HTMLElement | null;
    return at?.matches("[data-card]") ? at.textContent : (at?.tagName ?? "");
  });

async function press(page: Page, keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** The board over the two notes, opened by the leader (vim on) or the palette (vim off); records each note write from then on. */
async function board(
  page: Page,
  vault: string,
  vim = "on",
  empty = false,
  split = false,
): Promise<string[]> {
  if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await vaultWith(vault, {
    ...QUIET,
    "Long note.md": "# Long note\n",
    ...(empty
      ? {}
      : {
          [PLAN]: PLAN_LINES,
          [DAILY]: `${DAILY_LINES}\n`,
          "02 Projects/FDE/index.md": "# FDE\n",
          "02 Projects/Kasten/index.md": "# Kasten\n",
        }),
  });
  await openApp(page);
  // A pane beside, so an editor stays on screen for Escape to hand the focus to.
  if (split) await leader(page, "%");
  if (vim === "on") await leader(page, "gt");
  else {
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
  }
  await expect(region(page)).toBeVisible({ timeout: 15_000 });
  if (!empty) await expect(page.locator('[data-row*=".md:"]').first()).toBeVisible();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT"].includes(request.method()) && request.url().includes("/api/files/"))
      writes.push(request.url());
  });
  await page.keyboard.press("c");
  if (!empty) await expect(cursor(page)).toContainText("send the invoice");
  return writes;
}

test("A6 X moves the card to done, W to waiting, and x cycles it on", async ({ page, stack }) => {
  await board(page, stack.vault);
  const invoice = () => lineOf(stack.vault, DAILY, "send the invoice");
  await page.keyboard.press("X");
  await expect.poll(invoice).toMatch(new RegExp(`^- \\[x\\] send the invoice .* ✅ ${today()}`));
  // Each card that leaves Open hands the cursor to the next: the deck, then the tap.
  await expect(cursor(page)).toContainText("write the deck");
  await page.keyboard.press("W");
  await expect
    .poll(() => lineOf(stack.vault, PLAN, "write the deck"))
    .toMatch(/^- \[w\] write the deck /);
  await expect(cursor(page)).toContainText("fix the tap");
  await page.keyboard.press("x");
  await expect
    .poll(() => lineOf(stack.vault, DAILY, "fix the tap"))
    .toBe("- [/] fix the tap 🆔 kt-000009");
});

test("A7 Enter opens the cursor card's line, and a click opens the clicked card's", async ({
  page,
  stack,
}) => {
  await board(page, stack.vault);
  await page.keyboard.press("Enter");
  await expect(caretLine(page)).toContainText("send the invoice");
  await leader(page, "gt");
  await page.keyboard.press("c");
  await page.locator(`[data-card="${PLAN}:1"]`).click();
  await expect(caretLine(page)).toContainText("write the deck");
});

test("A8 p opens the project picker, Escape shuts it writing nothing, and j Enter files the card", async ({
  page,
  stack,
}) => {
  const writes = await board(page, stack.vault);
  await press(page, ["j", "j"]);
  await expect(cursor(page)).toContainText("fix the tap");
  await page.keyboard.press("p");
  await expect(picker(page).locator("[aria-current]")).toHaveText(["FDE", "Kasten"]);
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  expect(writes).toEqual([]);

  await press(page, ["p", "j", "Enter"]);
  await expect(picker(page)).toHaveCount(0);
  await expect
    .poll(() => lineOf(stack.vault, DAILY, "fix the tap"))
    .toBe(`- [ ] fix the tap ${KASTEN} 🆔 kt-000009`);
});

test("A8 a click picks, and a card already filed under the pick writes nothing", async ({
  page,
  stack,
}) => {
  const writes = await board(page, stack.vault);
  await page.keyboard.press("p");
  await picker(page).getByRole("button", { name: "FDE" }).click();
  await expect(picker(page)).toHaveCount(0);
  // A pick that writes says so; give it the time a write takes before reading none.
  await page.waitForTimeout(500);
  expect(writes).toEqual([]);
});

test("A9 h l move between columns and j k between the cards of one, across lanes", async ({
  page,
  stack,
}) => {
  await board(page, stack.vault);
  const walk: [string, string][] = [
    ["l", "draw the chart"],
    ["h", "send the invoice"],
    ["j", "write the deck"],
    ["j", "fix the tap"],
    ["j", "fix the tap"],
    ["k", "write the deck"],
  ];
  for (const [key, words] of walk) {
    await page.keyboard.press(key);
    await expect(cursor(page)).toContainText(words);
  }
});

test("A11 the filter line and the views narrow the cards", async ({ page, stack }) => {
  await board(page, stack.vault);
  await filter(page).fill("#client");
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page)).toContainText(["send the invoice"]);
  await filter(page).fill("");
  await page.keyboard.press("Escape");
  await press(page, ["v", "v"]);
  await expect(filter(page)).toHaveValue("/doing");
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page)).toContainText(["draw the chart"]);
});

for (const vim of ["on", "off"])
  test(`I1 #1515 a card X moved out of its column leaves the cursor and the focus on the next card, in the change that drops it, vim ${vim}`, async ({
    page,
    stack,
  }) => {
    await board(page, stack.vault, vim);
    await expect.poll(() => focused(page)).toContain("send the invoice");
    await watchDrop(page, "send the invoice");
    await page.keyboard.press("X");
    await expect.poll(() => atDrop(page)).toContain("write the deck");
    await expect(cursor(page)).toContainText("write the deck");
    await expect.poll(() => focused(page)).toContain("write the deck");
    await page.keyboard.press("j");
    await expect(cursor(page)).toContainText("fix the tap");
  });

test("I3 an empty board and an empty column draw, and keys on them write and open nothing", async ({
  page,
  stack,
}) => {
  const none = await board(page, stack.vault, "on", true);
  await expect(page.getByText("nothing on the board")).toBeVisible();
  await press(page, ["j", "k", "h", "l", "x", "X", "Enter", "p", "g"]);
  await expect(page.getByText("nothing on the board")).toBeVisible();
  await expect(picker(page)).toHaveCount(0);
  await expect(caretLine(page)).toHaveCount(0);
  expect(none).toEqual([]);
});

test("I3 keys on a column with no card write, open and pick nothing", async ({ page, stack }) => {
  const writes = await board(page, stack.vault);
  // Review holds nothing.
  await press(page, ["l", "l", "j", "k", "x", "O", "Enter", "p"]);
  await expect(card(page, "send the invoice")).toBeVisible();
  await expect(picker(page)).toHaveCount(0);
  await expect(caretLine(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(writes).toEqual([]);
});

test("I4 a leader sequence, /, Escape and q still work on the board", async ({ page, stack }) => {
  await board(page, stack.vault, "on", false, true);
  await leader(page, "cd");
  await expect(page.getByRole("dialog", { name: "Capture a thought" })).toBeVisible();
  // The c went to the leader, so the board is still up.
  await expect(card(page, "send the invoice")).toBeVisible();
  await page.keyboard.press("Escape");
  await card(page, "send the invoice").focus();
  await leader(page, "ct");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab").first().click();
  // The tab drew the pane afresh, as the list.
  await page.locator('[data-row*=".md:"]').first().focus();
  await page.keyboard.press("c");
  await card(page, "send the invoice").focus();
  await page.keyboard.press("/");
  await expect(filter(page)).toBeFocused();
  await card(page, "send the invoice").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-content").first()).toBeFocused();
  await card(page, "send the invoice").focus();
  await page.keyboard.press("q");
  await expect(region(page)).toHaveCount(0);
});

test("I5 O on a done card puts it back to open", async ({ page, stack }) => {
  await board(page, stack.vault);
  await press(page, ["l", "l", "l", "l", "l"]);
  await expect(cursor(page)).toContainText("gather numbers");
  await page.keyboard.press("O");
  await expect
    .poll(() => lineOf(stack.vault, PLAN, "gather numbers"))
    .toBe("  - [ ] gather numbers");
});

test("I6 P and a pick write the very line the vault holds, every mark on it kept", async ({
  page,
  stack,
}) => {
  await board(page, stack.vault);
  await page.keyboard.press("j");
  await page.keyboard.press("P");
  await expect
    .poll(() => lineOf(stack.vault, PLAN, "write the deck"))
    .toBe(DECK.replace("[ ]", "[/]"));
  // The deck left Open, so the cursor sits on the tap below it.
  await expect(cursor(page)).toContainText("fix the tap");
  await press(page, ["p", "Enter"]);
  await expect
    .poll(() => lineOf(stack.vault, DAILY, "fix the tap"))
    .toBe("- [ ] fix the tap [[02 Projects/FDE/index|FDE]] 🆔 kt-000009");
});

test("#773 I2 Enter on the focused cursor card picks in the open picker and opens no note", async ({
  page,
  stack,
}) => {
  await board(page, stack.vault);
  await press(page, ["j", "j", "p", "j"]);
  await expect(picker(page)).toBeVisible();
  await cursor(page).focus();
  await expect(cursor(page)).toContainText("fix the tap");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => lineOf(stack.vault, DAILY, "fix the tap"))
    .toBe(`- [ ] fix the tap ${KASTEN} 🆔 kt-000009`);
  await expect(caretLine(page)).toHaveCount(0);
  await expect(region(page)).toBeVisible();
});
