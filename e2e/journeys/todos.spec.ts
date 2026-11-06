import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { leader, openApp } from "../harness/app.ts";
import { expect, test } from "../harness/stack.ts";

test("checking off a todo in the todo pane changes the note's line", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "gt");
  await expect(page.getByRole("button", { name: "open water the tomatoes" })).toBeVisible();
  // The first row starts under the cursor; X sets it done.
  await page.keyboard.press("X");
  await expect
    .poll(() => readFile(join(stack.vault, "02 Projects/Garden.md"), "utf8"), { timeout: 15_000 })
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
