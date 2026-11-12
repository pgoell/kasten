import type { Page } from "@playwright/test";
import { phone, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

// nginx serves the lists app on the share host's name alone (#736), the name frontend/nginx.conf writes out.
const SHARE_HOST = "liste.pgoell.com";

/** Opens the lists app as the share host serves it, over the shopping list the test's vault holds. */
async function openLists(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, { "05 Shared/Einkauf.md": "- [ ] Milch\n" });
  // Chromium sends its own Host; the request made here names the share host instead.
  await page.route("**/lists.html", async (route) =>
    route.fulfill({
      response: await route.fetch({ headers: { ...route.request().headers(), host: SHARE_HOST } }),
    }),
  );
  await page.goto("/lists.html");
  // The item is read from the vault through the backend's `/share`.
  await expect(page.getByText("Milch")).toBeVisible({ timeout: 15_000 });
}

/** The page's scheme and the colour the theme's CSS paints its background with. */
const painted = (page: Page) =>
  page.evaluate(() => [
    document.documentElement.dataset.theme,
    getComputedStyle(document.body).backgroundColor,
  ]);

test.describe("on a phone", () => {
  test.use(phone);
  test.use({ colorScheme: "dark" });

  test("the lists app is dark when the phone is dark and turns light when the phone does, while open", async ({
    page,
    stack,
  }) => {
    await openLists(page, stack.vault);
    await expect.poll(async () => (await painted(page))[0]).toBe("dark");
    const [, dark] = await painted(page);

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(async () => (await painted(page))[0]).toBe("light");
    expect((await painted(page))[1]).not.toBe(dark);
  });
});
