import { leader, openApp } from "../harness/app.ts";
import { expect, test } from "../harness/stack.ts";

test("the finder opens the note it finds", async ({ page }) => {
  await openApp(page);
  await leader(page, "ff");
  await page.keyboard.type("Garden");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("water the tomatoes");
});
