import type { Page } from "@playwright/test";
import { builtCss, leader, openApp, phone, TODO_ROW, vaultWith } from "../../harness/app.ts";
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

test("the lists app's top bar blurs the list behind it, with Safari's prefix ahead in the css", async ({
  page,
  stack,
}) => {
  await openLists(page, stack.vault);
  // Vite's Lightning CSS minifier dropped this line when the source wrote the -webkit- twin after it (#1986).
  expect(
    await page.locator("header.top").evaluate((bar) => getComputedStyle(bar).backdropFilter),
  ).toBe("blur(18px) saturate(1.4)");
  expect(await builtCss(page)).toMatch(
    /\.top\{[^}]*-webkit-backdrop-filter:blur\(18px\) ?saturate\(1\.4\);backdrop-filter:blur\(18px\) ?saturate\(1\.4\)[;}]/,
  );
});

const SCOPE = {
  "02 Projects/Calls.md": "# Calls\n\n- [ ] call the client #client\n- [ ] fix the tap #internal\n",
  "05 Shared/Einkauf.md": "# Einkauf\n\n- [ ] send the offer #client\n",
};
const row = (page: Page, text: string) => page.locator(TODO_ROW, { hasText: text });
const toggle = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** The todo pane over SCOPE's two notes, once its rows are drawn. */
async function todoPane(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, SCOPE);
  await openApp(page);
  await leader(page, "gt");
  await expect(row(page, "call the client")).toBeVisible();
}

test.describe("the todo pane's shared lists", () => {
  test("are hidden at first, the toggle says how many and shows them, and a reload keeps that until it is turned off", async ({
    page,
    stack,
  }) => {
    await todoPane(page, stack.vault);
    await expect(toggle(page, "Shared lists, 1 hidden")).toHaveAttribute("aria-pressed", "false");
    await expect(row(page, "send the offer")).toHaveCount(0);
    await toggle(page, "Shared lists, 1 hidden").click();
    await expect(row(page, "send the offer")).toBeVisible();
    await expect(toggle(page, "Shared lists, shown")).toHaveAttribute("aria-pressed", "true");
    const stored = () => page.evaluate(() => localStorage.getItem("kasten.todos.shared"));
    expect(await stored()).toBe("1");

    await page.reload();
    await leader(page, "gt");
    await expect(row(page, "send the offer")).toBeVisible({ timeout: 15_000 });
    await toggle(page, "Shared lists, shown").click();
    await expect(row(page, "send the offer")).toHaveCount(0);
    expect(await stored()).toBe(null);

    await page.reload();
    await leader(page, "gt");
    await expect(toggle(page, "Shared lists, 1 hidden")).toBeVisible({ timeout: 15_000 });
    await expect(row(page, "send the offer")).toHaveCount(0);
  });

  test("stay hidden when site data is blocked, and the toggle still shows and hides them", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => {
      const blocked = () => {
        throw new DOMException("site data is blocked", "SecurityError");
      };
      Storage.prototype.getItem = blocked;
      Storage.prototype.setItem = blocked;
      Storage.prototype.removeItem = blocked;
    });
    // A throw in the click handler leaves the screen as it was; only the page sees it.
    const thrown: string[] = [];
    page.on("pageerror", (error) => thrown.push(error.message));
    await todoPane(page, stack.vault);
    await expect(row(page, "send the offer")).toHaveCount(0);
    await toggle(page, "Shared lists, 1 hidden").click();
    await expect(row(page, "send the offer")).toBeVisible();
    await toggle(page, "Shared lists, shown").click();
    await expect(row(page, "send the offer")).toHaveCount(0);
    expect(thrown).toEqual([]);
  });

  test("a kind chip, the toggle and the typed filter narrow the list together, and All widens it", async ({
    page,
    stack,
  }) => {
    await todoPane(page, stack.vault);
    await toggle(page, "#client").click();
    await expect(row(page, "call the client")).toBeVisible();
    await expect(row(page, "fix the tap")).toHaveCount(0);
    await expect(row(page, "fold the laundry")).toHaveCount(0);
    await expect(row(page, "send the offer")).toHaveCount(0);

    await toggle(page, "Shared lists, 1 hidden").click();
    await expect(row(page, "send the offer")).toBeVisible();
    await page.getByLabel("filter todos").fill("offer");
    await expect(row(page, "send the offer")).toBeVisible();
    await expect(row(page, "call the client")).toHaveCount(0);

    await toggle(page, "Shared lists, shown").click();
    await expect(toggle(page, "Shared lists, 1 hidden")).toBeVisible();
    await expect(row(page, "send the offer")).toHaveCount(0);
    await page.getByLabel("filter todos").fill("");
    await toggle(page, "All").click();
    await expect(row(page, "fix the tap")).toBeVisible();
    await expect(row(page, "fold the laundry")).toBeVisible();
  });
});
