import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { leader, openApp } from "../../harness/app.ts";
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
    .poll(() => readFile(join(stack.vault, "02 Projects/Home.md"), "utf8"), { timeout: 15_000 })
    .toMatch(/^- \[\/\] fold the laundry/m);
});
