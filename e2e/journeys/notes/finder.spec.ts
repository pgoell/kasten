import { findNote, leader, openApp, phone } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

test("the finder opens the note it finds", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Garden");
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

test.describe("on a phone", () => {
  test.use(phone);

  test("the finder opened from the thumb row opens the note it finds", async ({ page }) => {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Find a note" }).tap();
    const finder = page.getByRole("dialog", { name: "Find note" });
    await finder.getByRole("combobox").fill("Garden");
    await finder
      .getByRole("option", { name: /Garden/ })
      .first()
      .tap();
    await expect(finder).toBeHidden();
    await expect(page.locator(".cm-content")).toContainText("water the tomatoes");
  });
});
