import type { Locator, Page } from "@playwright/test";
import { cursorTo, phone, runCommand, TODO_ROW, vaultWith } from "../../../../harness/app.ts";
import { expect, test } from "../../../../harness/stack.ts";

// An assignee chip while GET /api/files has not answered (#2124): it does not know yet
// whether its name has a note, so it neither looks like "no note" nor opens the row's note.
const PASCAL = "03 Areas/08 People/Pascal.md";
const CHORES = "02 Projects/Chores.md";
const YARD = "02 Projects/Yard.md";
const CHORE_LINES = ["- [ ] buy paint 👤 [[Pascal]]", "- [ ] rake the leaves 👤 [[Nobody]]"];
const YARD_LINE = "- [ ] sweep the yard 👤 [[Pascal]]";

type Row = { id: string; words: string; state: string; blocked_by: string[] };
/** The store's todos by their words. */
async function rows(url: string): Promise<Record<string, Row>> {
  const all: Row[] = await (await fetch(`${url}/api/todos/rows`)).json();
  return Object.fromEntries(all.map((row) => [row.words, row]));
}
const byWords = (all: Record<string, Row>, words: string) =>
  Object.values(all).find((row) => row.words.includes(words));

const row = (page: Page, words: string) => page.locator(TODO_ROW, { hasText: words });
const card = (page: Page, words: string) => page.locator("[data-card]", { hasText: words });
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const pill = (chip: Locator) => chip.locator("span");
const look = (chip: Locator) =>
  pill(chip).evaluate((el) => {
    const style = getComputedStyle(el);
    return { border: style.borderTopStyle, color: style.color, fill: style.backgroundColor };
  });

/** The vault for the pane, and every GET of the file list held until `release`. */
async function heldList(page: Page, vault: string, answer: "list" | "fail" = "list") {
  await vaultWith(vault, {
    [PASCAL]: "---\ntype: Person\n---\n\n# Pascal\n",
    [CHORES]: `# Chores\n\n${CHORE_LINES.join("\n")}\n`,
    [YARD]: `# Yard\n\n${YARD_LINE}\n`,
  });
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/files", async (route) => {
    await held;
    if (answer === "fail") await route.fulfill({ status: 500 });
    else await route.fallback();
  });
  return release;
}

/** Opens the todo pane while the file list is held: the palette on a desktop, the toolbar on a phone. */
async function openPane(page: Page, by: "click" | "tap") {
  await page.goto("/");
  // The first load parses the whole bundle, which takes past 5 s on a loaded box (#1615).
  if (by === "click") await expect(page.locator(".cm-content")).toBeVisible({ timeout: 15_000 });
  await reopen(page, by);
  await expect(row(page, "sweep the yard")).toBeVisible();
}

/** Brings the todo pane back after a note took its place. */
async function reopen(page: Page, by: "click" | "tap") {
  if (by === "tap") {
    const button = page.getByRole("button", { name: "Open the todo pane" });
    await button.tap({ timeout: 15_000 });
    return;
  }
  await runCommand(page, /^Open the todo pane/);
}

/** A chip that waits: no dash, no fill, not the link colour, and no person note to open. */
async function waits(chip: Locator) {
  await expect(chip).toBeVisible();
  const seen = await look(chip);
  expect(seen.border).not.toBe("dashed");
  expect(seen.fill).toBe("rgba(0, 0, 0, 0)");
  await expect(chip).toHaveAttribute("data-person-loading", "");
  await expect(chip).not.toHaveAttribute("data-person-path");
  return seen;
}

/** After the list lands: Pascal's chip solid in another colour, Nobody's dashed as today. */
async function landed(page: Page, loading: { color: string }) {
  const pascal = row(page, "buy paint").locator("[data-person]");
  const nobody = row(page, "rake the leaves").locator("[data-person]");
  await expect(pascal).toHaveAttribute("data-person-path", PASCAL);
  await expect(pill(pascal)).toHaveCSS("border-top-style", "solid");
  await expect(pill(pascal)).not.toHaveCSS("color", loading.color);
  await expect(pill(nobody)).toHaveCSS("border-top-style", "dashed");
  await expect(nobody).not.toHaveAttribute("data-person-loading");
}

test("while the file list loads a chip draws neither look and a click on it opens no note, then it opens the person note", async ({
  page,
  stack,
}) => {
  const release = await heldList(page, stack.vault);
  await openPane(page, "click");
  const pascal = row(page, "buy paint").locator("[data-person]");
  const loading = await waits(pascal);
  await waits(row(page, "rake the leaves").locator("[data-person]"));
  await pascal.click();
  // A press beside the chip still opens the row's note; the chip's press came first.
  await row(page, "sweep the yard").getByText("sweep the yard", { exact: true }).click();
  await expect(tab(page, "Yard")).toBeVisible();
  await expect(tab(page, "Chores")).toHaveCount(0);
  await expect(tab(page, "Pascal")).toHaveCount(0);
  release();
  await reopen(page, "click");
  await landed(page, loading);
  await pascal.click();
  await expect(tab(page, "Pascal")).toBeVisible();
  await reopen(page, "click");
  await row(page, "rake the leaves").locator("[data-person]").click();
  await expect(tab(page, "Chores")).toBeVisible();
});

for (const vim of ["on", "off"])
  test(`while the file list loads, Enter on a row opens its note and a chip clicked while picking a blocker is picked, vim ${vim}`, async ({
    page,
    stack,
  }) => {
    if (vim === "off") await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await picksAndEnters(page, stack.vault, stack.url);
  });

async function picksAndEnters(page: Page, vault: string, url: string) {
  const release = await heldList(page, vault);
  await openPane(page, "click");
  await cursorTo(page, "buy paint");
  await page.keyboard.press("b");
  await expect(page.getByTestId("todo-pick")).toBeVisible();
  await row(page, "sweep the yard").locator("[data-person]").click();
  const yard = byWords(await rows(url), "sweep the yard")?.id;
  await expect.poll(async () => byWords(await rows(url), "buy paint")?.blocked_by).toEqual([yard]);
  await expect(tab(page, "Yard")).toHaveCount(0);
  await cursorTo(page, "rake the leaves");
  await page.keyboard.press("Enter");
  await expect(tab(page, "Chores")).toBeVisible();
  release();
}

test("when the file list fails a chip draws dashed and a click on it opens the row's note", async ({
  page,
  stack,
}) => {
  const release = await heldList(page, stack.vault, "fail");
  await openPane(page, "click");
  release();
  const pascal = row(page, "buy paint").locator("[data-person]");
  await expect(pill(pascal)).toHaveCSS("border-top-style", "dashed");
  await pascal.click();
  await expect(tab(page, "Chores")).toBeVisible();
});

test("a board card's chip waits for the file list and a click on it opens no note", async ({
  page,
  stack,
}) => {
  const release = await heldList(page, stack.vault);
  await openPane(page, "click");
  await page.keyboard.press("c");
  const chip = card(page, "buy paint").locator("[data-person]");
  await waits(chip);
  await chip.click();
  await card(page, "sweep the yard").getByText("sweep the yard", { exact: true }).click();
  await expect(tab(page, "Yard")).toBeVisible();
  await expect(tab(page, "Chores")).toHaveCount(0);
  release();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("while the file list loads a tap on a chip opens no note and sets no state, then it opens the person note", async ({
    page,
    stack,
  }) => {
    const release = await heldList(page, stack.vault);
    await openPane(page, "tap");
    const before = await rows(stack.url);
    const pascal = row(page, "buy paint").locator("[data-person]");
    const loading = await waits(pascal);
    await pascal.tap();
    await row(page, "sweep the yard").getByText("sweep the yard", { exact: true }).tap();
    await expect(tab(page, "Yard")).toBeVisible();
    await expect(tab(page, "Chores")).toHaveCount(0);
    release();
    await reopen(page, "tap");
    await landed(page, loading);
    await pascal.tap();
    await expect(tab(page, "Pascal")).toBeVisible();
    expect(await rows(stack.url)).toEqual(before);
  });

  test("a board card's chip waits for the file list and a tap on it opens no note", async ({
    page,
    stack,
  }) => {
    const release = await heldList(page, stack.vault);
    await openPane(page, "tap");
    await page.getByRole("button", { name: "board", exact: true }).tap();
    const chip = card(page, "buy paint").locator("[data-person]");
    await waits(chip);
    await chip.tap();
    await card(page, "sweep the yard").getByText("sweep the yard", { exact: true }).tap();
    await expect(tab(page, "Yard")).toBeVisible();
    await expect(tab(page, "Chores")).toHaveCount(0);
    release();
  });
});
