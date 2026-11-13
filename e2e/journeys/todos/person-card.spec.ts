import type { Page } from "@playwright/test";
import { leader, noteText, openApp, phone, TODO_ROW, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const PASCAL = "03 Areas/08 People/Pascal.md";
// The todo's words hold no link: only the `👤 [[Pascal]]` field names him.
const NOTES = {
  [PASCAL]: "---\ntype: Person\n---\n\n# Pascal\n",
  "01 Periodic/00 Daily/2026-10-25.md":
    "# 2026-10-25\n\n- [ ] buy paint 👤 [[Pascal]]\n- [ ] fix the gate 👤 [[Alicia]]\n",
  "03 Areas/08 People/Alicia.md": "---\ntype: Person\n---\n\n# Alicia\n",
};

/** Opens Pascal's note by its address and returns the card's open todos. */
async function pascalsTodos(page: Page, vault: string) {
  await vaultWith(vault, NOTES);
  await page.goto(`/?note=${encodeURIComponent(PASCAL)}`);
  const todos = page.getByRole("region", { name: "Open todos" });
  // The first load parses the whole bundle, which takes past 5 s on a loaded box (#1615).
  await expect(todos).toBeVisible({ timeout: 15_000 });
  return todos;
}

const listsOnlyHisTodo = async (page: Page, vault: string) => {
  const todos = await pascalsTodos(page, vault);
  // One row: Alicia's todo, the same shape, stays off Pascal's card.
  await expect(todos.getByRole("button")).toHaveText([/buy paint$/]);
};

test("a person note's footer lists the open todo assigned to them by 👤 [[name]], and no one else's", async ({
  page,
  stack,
}) => {
  await listsOnlyHisTodo(page, stack.vault);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a person note's footer lists the open todo assigned to them by 👤 [[name]], and no one else's", async ({
    page,
    stack,
  }) => {
    await listsOnlyHisTodo(page, stack.vault);
  });

  test("a tap on a board card's assignee chip opens the person note", async ({ page, stack }) => {
    const { chip, writes } = await chippedCard(page, stack.vault);
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap();
    await page.getByRole("button", { name: "board", exact: true }).tap();
    await chip.tap();
    await opensPascal(page, stack.vault, writes);
  });
});

const CHIPS = "02 Projects/Chips.md";
const INVOICE = "- [ ] send the invoice 👤 [[Pascal]] #client";

/** A board card whose assignee has a note, and every write the page sends from here on. */
async function chippedCard(page: Page, vault: string) {
  await vaultWith(vault, {
    ...NOTES,
    [CHIPS]: `# Chips\n\n${INVOICE}\n- [ ] fix the tap 👤 Alicia #client\n`,
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(request.url());
  });
  const card = page.locator("[data-card]", { hasText: "send the invoice" });
  const chip = card.locator(`[data-person-path="${PASCAL}"]`);
  return { card, chip, writes };
}

/** The person note fills a tab of its own, the card's note untouched and nothing written. */
async function opensPascal(page: Page, vault: string, writes: string[]) {
  await expect(page.getByRole("tab", { name: "Pascal", selected: true })).toBeVisible();
  await expect(page.locator(".cm-content:visible", { hasText: "Pascal" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Chips" })).toHaveCount(0);
  expect(await noteText(vault, CHIPS)).toContain(INVOICE);
  expect(writes).toEqual([]);
}

test("a click on a board card's assignee chip opens the person note", async ({ page, stack }) => {
  const { chip, writes } = await chippedCard(page, stack.vault);
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(TODO_ROW, { hasText: "send the invoice" })).toBeVisible();
  await page.keyboard.press("c");
  await chip.click();
  await opensPascal(page, stack.vault, writes);
});

test("a drag that starts on a board card's chip moves the card and opens no note", async ({
  page,
  stack,
}) => {
  const { card, chip } = await chippedCard(page, stack.vault);
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(TODO_ROW, { hasText: "send the invoice" })).toBeVisible();
  await page.keyboard.press("c");
  const lane = await card.evaluate((el) => el.closest("[data-column]")?.getAttribute("data-lane"));
  const from = await chip.boundingBox();
  const to = await page.locator(`[data-column="done"][data-lane="${lane}"]`).boundingBox();
  if (!from || !to) throw new Error("the chip or the done cell is not on the screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => noteText(stack.vault, CHIPS), { timeout: 15_000 })
    .toMatch(/^- \[x\] send the invoice/m);
  await expect(page.getByRole("tab", { name: "Pascal" })).toHaveCount(0);
});
