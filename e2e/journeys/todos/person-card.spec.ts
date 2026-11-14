import type { Page } from "@playwright/test";
import {
  cursorTo,
  leader,
  noteText,
  openApp,
  openNote,
  phone,
  TODO_ROW,
  tapHeight,
  today,
  vaultWith,
} from "../../harness/app.ts";
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
    await opensPascal(page, stack.vault, writes, async () => {
      await page.getByRole("button", { name: "Open the todo pane" }).tap();
      await page.getByRole("button", { name: "more for fix the tap" }).tap();
      await page.getByRole("button", { name: "done fix the tap" }).tap();
    });
  });
});

const CHIPS = "02 Projects/Chips.md";
const INVOICE = "- [ ] send the invoice 👤 [[Pascal]] #client";

/** A board card whose assignee has a note, and every write the page sends from here on, by its URL. */
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

/**
 * The person note fills a tab of its own and the card's note stays shut. Then `tick` checks off the
 * other card for real: todo writes go in turn, so once its two land, a write the chip sent would have too.
 */
async function opensPascal(page: Page, vault: string, writes: string[], tick: () => Promise<void>) {
  await expect(page.getByRole("tab", { name: "Pascal", selected: true })).toBeVisible();
  await expect(page.locator(".cm-content:visible", { hasText: "Pascal" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Chips" })).toHaveCount(0);
  await tick();
  await expect
    .poll(() => noteText(vault, CHIPS), { timeout: 15_000 })
    .toMatch(/^- \[x\] fix the tap/m);
  const daily = `01 Periodic/00 Daily/${today()}.md`;
  await expect
    .poll(() => writes.map((url) => decodeURIComponent(url.replace(/^.*\/api\//, ""))))
    .toEqual([`files/${CHIPS}`, `files/${daily}`]);
  expect(await noteText(vault, CHIPS)).toContain(INVOICE);
}

test("a click on a board card's assignee chip opens the person note", async ({ page, stack }) => {
  const { chip, writes } = await chippedCard(page, stack.vault);
  await openApp(page);
  await leader(page, "gt");
  await expect(page.locator(TODO_ROW, { hasText: "send the invoice" })).toBeVisible();
  await page.keyboard.press("c");
  await chip.click();
  await opensPascal(page, stack.vault, writes, async () => {
    await leader(page, "gt");
    await cursorTo(page, "fix the tap");
    await page.keyboard.press("X");
  });
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

const MAX = "03 Areas/08 People/Max Bosch.md";
const MEETING = "02 Projects/FDE/2026-09-28 FDE Check-in.md";
const MET = "[[Max Bosch]] and me, 20 min";
const CARD = {
  [MAX]: "---\ntype: Person\n---\n\n# Max Bosch\n",
  "03 Areas/08 People/Nobody.md": "---\ntype: Person\n---\n\n# Nobody\n",
  [MEETING]: `# FDE Check-in\n\nagenda\n\n${MET}\n\nnext time\n`,
  "Plain.md": "---\ntype: Note\n---\n\n# Plain\n",
  "01 Periodic/00 Daily/2026-09-30.md":
    "# 2026-09-30\n\n- [ ] send [[Max Bosch]] the repo 📅 2026-10-02\n- [ ] something nobody is named in\n- [ ] call [[Plain]]\n- ✅ 2026-09-29 paired with [[Max Bosch]]\n",
};

/** Opens a note of CARD by its address and returns its footer's three sections. */
async function maxCard(page: Page, vault: string, path = MAX) {
  await vaultWith(vault, CARD);
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  const section = (name: string) => page.getByRole("region", { name });
  return {
    todos: section("Open todos"),
    met: section("Last meetings"),
    done: section("Recently done"),
  };
}

test.describe("the person card", () => {
  test("draws the person's open todos, last meetings and done lines, and no card under a note of another type", async ({
    page,
    stack,
  }) => {
    const { todos, met, done } = await maxCard(page, stack.vault);
    // The first load parses the whole bundle, which takes past 5 s on a loaded box (#1615).
    await expect(todos.getByRole("button")).toHaveText(
      [/send Max Bosch the repo\s*📅 2026-10-02$/],
      {
        timeout: 15_000,
      },
    );
    await expect(met.getByRole("button")).toHaveText(["2026-09-28FDE Check-in"]);
    await expect(done.getByRole("button")).toHaveText(["2026-09-29paired with Max Bosch"]);

    // The todo cache is filled now, so a card the Note would draw shows at once.
    await openNote(page, "Plain");
    await expect(page.locator(".cm-content:visible", { hasText: "Plain" })).toBeVisible();
    await expect(page.getByText("call Plain")).toHaveCount(0);
    await expect(todos).toHaveCount(0);
  });

  test("a click on a row opens the note it names with the cursor on that line", async ({
    page,
    stack,
  }) => {
    const { met } = await maxCard(page, stack.vault);
    await met.getByRole("button", { name: /FDE Check-in/ }).click({ timeout: 15_000 });
    await expect(
      page.getByRole("tab", { name: "2026-09-28 FDE Check-in", selected: true }),
    ).toBeVisible();
    await expect(page.locator(".cm-content:focus .cm-activeLine")).toHaveText(
      "Max Bosch and me, 20 min",
    );
  });

  test("a person nothing links gets the sentence that says how the card fills", async ({
    page,
    stack,
  }) => {
    await maxCard(page, stack.vault, "03 Areas/08 People/Nobody.md");
    await expect(
      page.getByText("nothing links [[Nobody]] yet. Write the link into a todo and it shows here."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: /open todos|last meetings|recently done/ }),
    ).toHaveCount(0);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("every row of the card is at least 44 px tall", async ({ page, stack }) => {
      const { todos } = await maxCard(page, stack.vault);
      await expect(todos).toBeVisible({ timeout: 15_000 });
      const rows = page.locator("section[aria-label] button");
      await expect(rows).toHaveCount(3);
      for (const row of await rows.all()) expect(await tapHeight(row)).toBeGreaterThanOrEqual(44);
    });
  });
});
