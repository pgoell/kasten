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

  test("each row says how long since its token was used, marks one silent 30 days, and the head counts it", async ({
    page,
  }) => {
    const now = Date.now();
    const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    const day = 24 * 60;
    // A fixed clock, so 3 min cannot tick to 4; only the list's own read is answered here.
    await page.clock.setFixedTime(now);
    const rows = [
      ["yesterday", ago(2 * day), ago(25 * 60)],
      ["minutes", ago(2 * day), ago(3)],
      ["unplugged", ago(day), null],
      ["old", ago(60 * day), ago(31 * day)],
      ["recent", ago(60 * day), ago(29 * day)],
    ].map(([name, created, last_used]) => ({ name, created, last_used, scope: "agent" }));
    await page.route("**/api/tokens", (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: rows }) : route.fallback(),
    );
    await openOn(page, []);

    const row = (name: string) => page.locator("li", { has: revoke(page, name) });
    await expect(row("yesterday")).toContainText("used 1 day ago");
    await expect(page.getByText(/\b1 days/)).toHaveCount(0);
    await expect(row("minutes")).toContainText("used 3 min ago");
    await expect(row("unplugged")).toContainText("never used");
    await expect(row("old")).toContainText("used 31 days ago");
    await expect(row("old").getByText("unused 30 days")).toBeVisible();
    await expect(row("recent")).toContainText("used 29 days ago");
    await expect(page.getByText("unused 30 days", { exact: true })).toHaveCount(1);
    await expect(page.getByText("5 in the vault, 1 unused for 30 days")).toBeVisible();
  });

  test("Actions opens the token's own requests, newest first, and the head counts no token in use", async ({
    page,
  }) => {
    const minted = await page.request.post("/api/tokens", { data: { name: "laptop" } });
    const { secret } = (await minted.json()) as { secret: string };
    const headers = { Authorization: `Bearer ${secret}` };
    expect((await page.request.get("/agent/notes/Welcome.md", { headers })).status()).toBe(200);
    expect((await page.request.get("/agent/notes/Missing.md", { headers })).status()).toBe(404);
    // The log is written after each answer, so the page opens once both rows are in.
    await expect
      .poll(
        async () => (await (await page.request.get("/api/tokens/laptop/actions")).json()).length,
      )
      .toBe(2);
    await openOn(page, []);

    await expect(page.locator("li", { has: revoke(page, "laptop") })).toContainText(
      "used just now",
    );
    await expect(page.getByText("1 in the vault", { exact: true })).toBeVisible();
    const button = page.getByRole("button", { name: "Actions" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator(`[id="${await button.getAttribute("aria-controls")}"] li`),
    ).toHaveText([
      /^just nowGET \/agent\/notes\/Missing\.mdMissing\.md404 error$/,
      /^just nowGET \/agent\/notes\/Welcome\.mdWelcome\.md$/,
    ]);
  });

  test("the head stops saying Loading when the list fails, and says so", async ({ page }) => {
    await page.route("**/api/tokens", (route) =>
      route.request().method() === "GET" ? route.fulfill({ status: 500 }) : route.fallback(),
    );
    await openOn(page, []);

    await expect(page.getByText("Could not load the tokens.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Agent tokens" }).locator(".."),
    ).not.toContainText("Loading");
  });
});
