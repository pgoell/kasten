import type { Dialog, Page } from "@playwright/test";
import { expect, test } from "../../harness/stack.ts";

// Matched by shape, never by value: a red run prints its locators.
const SECRET = /^kasten_[\w-]{20,}$/;

/** The names the backend lists, read past the page. */
async function held(page: Page): Promise<string[]> {
  const answer = await page.request.get("/api/tokens");
  return ((await answer.json()) as { name: string }[]).map((token) => token.name).sort();
}

/** Mints `names` through the backend, then opens the page on them. */
async function openOn(page: Page, names: string[]) {
  for (const name of names) await page.request.post("/api/tokens", { data: { name } });
  await page.goto("/tokens");
  await expect(page.getByRole("heading", { name: "Agent tokens" })).toBeVisible({
    timeout: 15_000,
  });
}

/** Types `name` and mints it from the form. */
async function mint(page: Page, name: string) {
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Mint" }).click();
}

/** Answers every confirm with `accept`, keeping each message. */
function answerConfirms(page: Page, accept: boolean): string[] {
  const asked: string[] = [];
  page.on("dialog", (dialog: Dialog) => {
    asked.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  return asked;
}

const revoke = (page: Page, name: string) =>
  page.getByRole("button", { name: `Revoke ${name}`, exact: true });

test.describe("the tokens page", () => {
  test("draws one row per token the backend holds", async ({ page }) => {
    await openOn(page, ["laptop", "cron"]);

    await expect(revoke(page, "laptop")).toBeVisible();
    await expect(revoke(page, "cron")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Revoke / })).toHaveCount(2);
  });

  test("mints the typed name as an agent token and shows its secret once, which its own revoke takes away", async ({
    page,
  }) => {
    const asked = answerConfirms(page, true);
    await openOn(page, ["cron"]);

    await mint(page, "phone");

    await expect(page.getByText(SECRET)).toHaveCount(1);
    await expect(page.getByText(/claude mcp add .*\/agent\/mcp/)).toBeVisible();
    await expect(revoke(page, "phone")).toBeVisible();
    expect(await held(page)).toEqual(["cron", "phone"]);
    await revoke(page, "phone").click();
    await expect(page.getByText(SECRET)).toHaveCount(0);
    await expect(revoke(page, "phone")).toHaveCount(0);
    expect(asked).toEqual(["Revoke phone? Any agent using it stops working."]);
    expect(await held(page)).toEqual(["cron"]);
  });

  test("mints a reading-only token from the checkbox and shows the curl line for its route", async ({
    page,
  }) => {
    await openOn(page, []);

    await page.getByRole("checkbox").check();
    await mint(page, "website");

    await expect(
      page.getByText(/^curl -H "Authorization: Bearer .*\/agent\/reading$/),
    ).toBeVisible();
    await expect(page.locator("li", { hasText: "website only" })).toContainText("website");
    const answer = await page.request.get("/api/tokens");
    expect(await answer.json()).toEqual([
      expect.objectContaining({ name: "website", scope: "reading" }),
    ]);
  });

  test("revokes the row's own token, confirmed, and reads the list again without it", async ({
    page,
  }) => {
    answerConfirms(page, true);
    await openOn(page, ["laptop", "cron"]);

    await revoke(page, "cron").click();

    await expect(revoke(page, "cron")).toHaveCount(0);
    await expect(revoke(page, "laptop")).toBeVisible();
    expect(await held(page)).toEqual(["laptop"]);
  });

  test("leaves the token alone when the confirm is dismissed", async ({ page }) => {
    const asked = answerConfirms(page, false);
    await openOn(page, ["laptop", "cron"]);

    await revoke(page, "cron").click();
    await expect.poll(() => asked).toEqual(["Revoke cron? Any agent using it stops working."]);
    // A mint sent after the click lands after any revoke the click sent.
    await mint(page, "phone");
    await expect(revoke(page, "phone")).toBeVisible();

    await expect(revoke(page, "cron")).toBeVisible();
    expect(await held(page)).toEqual(["cron", "laptop", "phone"]);
  });

  test("links back to the notes, across to settings and to the shared lists, and names itself unlinked", async ({
    page,
  }) => {
    // The e2e stack serves no lists app, so its address is laid into the layout's answer.
    await page.route("**/api/layout", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), lists: "https://liste.example/" },
      });
    });
    await openOn(page, []);

    const nav = page.getByRole("navigation", { name: "Pages" });
    await expect(nav.getByRole("link", { name: "← notes" })).toHaveAttribute("href", "/");
    await expect(nav.getByRole("link", { name: "settings" })).toHaveAttribute("href", "/settings");
    await expect(nav.getByRole("link", { name: "lists" })).toHaveAttribute(
      "href",
      "https://liste.example/",
    );
    await expect(nav.getByRole("link", { name: "tokens" })).toHaveCount(0);
    await expect(nav).toContainText("tokens");
  });
});
