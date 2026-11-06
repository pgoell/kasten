import { leader, openApp } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

test("the finder opens the note it finds", async ({ page }) => {
  await openApp(page);
  await leader(page, "ff");
  await page.keyboard.type("Garden");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("water the tomatoes");
});

test("a content search opens the note on the line it matches", async ({ page }) => {
  await openApp(page);
  await leader(page, "fg");
  await page.keyboard.type("far away letter");
  await expect(page.getByRole("option", { name: /far away letter/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Long note", selected: true })).toBeVisible();
  const line = page.locator(".cm-line", {
    hasText: "reply to the far away letter",
  });
  await expect(line).toBeInViewport();
  await expect(page.locator(".cm-activeLine")).toContainText("reply to the far away letter");
});
