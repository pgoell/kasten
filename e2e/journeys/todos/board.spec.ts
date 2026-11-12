import { leader, noteText, openApp, phone, tapHeight } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

test("dragging a card to the doing column writes its doing mark", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "gt");
  // The list first, so `c` turns a loaded list into the board.
  await expect(page.locator('[data-row*=".md:"]', { hasText: "fold the laundry" })).toBeVisible();
  await page.keyboard.press("c");
  const card = page.locator("[data-card]", { hasText: "fold the laundry" });
  await expect(card).toBeVisible();
  // The doing cell in the card's own lane, so the drop stays within one project.
  const lane = await card.evaluate((el) => el.closest("[data-column]")?.getAttribute("data-lane"));
  const doing = page.locator(`[data-column="doing"][data-lane="${lane}"]`);
  const from = await card.boundingBox();
  const to = await doing.boundingBox();
  if (!from || !to) throw new Error("the card or the doing cell is not on the screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => noteText(stack.vault, "02 Projects/Home.md"), { timeout: 15_000 })
    .toMatch(/^- \[\/\] fold the laundry/m);
});

test.describe("on a phone", () => {
  test.use(phone);

  test("every tap target of the board is at least 44 px high: the lane switch, a state tab, a lane's heading, a card and its ⋯", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open the todo pane" }).tap();
    await page.getByRole("button", { name: "board", exact: true }).tap();
    const card = page.locator("[data-card]", { hasText: "fold the laundry" });
    await expect(card).toBeVisible();
    const lane = page
      .locator("[data-lane]", { has: card })
      .getByRole("heading")
      .getByRole("button");
    for (const target of [
      page.getByRole("button", { name: "kind", exact: true }),
      page.getByRole("button", { name: "project", exact: true }),
      page.getByRole("tab", { name: /^Open \d+$/ }),
      lane,
      card,
      page.getByRole("button", { name: "more for fold the laundry" }),
    ])
      expect(await tapHeight(target)).toBeGreaterThanOrEqual(44);
  });
});
