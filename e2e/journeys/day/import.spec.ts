import type { Page, Route } from "@playwright/test";
import { inbox, leader, noteText, openApp } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const ADDRESS = "https://example.com/post";
const PAGE =
  "<html><head><title>A walk in the park</title></head><body><article><p>We walked past the pond and the old oak tree.</p></article></body></html>";

/**
 * Answers every `/api/fetch` with `answer`, and keeps each address asked for. The stack has no
 * internet, so the backend's fetch is stood in for here.
 */
async function serveFetch(page: Page, answer: (route: Route) => Promise<void>): Promise<string[]> {
  const asked: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/fetch",
    async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get("url") ?? "");
      await answer(route);
    },
  );
  return asked;
}

/** Opens the import prompt by `<leader>cw` from the editor. */
async function openPrompt(page: Page) {
  await openApp(page);
  await leader(page, "cw");
  const dialog = page.getByRole("dialog", { name: "Import a web page" });
  await expect(dialog).toBeVisible();
  return { dialog, field: dialog.getByLabel("import"), status: dialog.getByRole("status") };
}

const fail = (detail: string) => (route: Route) =>
  route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ detail }) });

test.describe("the import prompt", () => {
  test("takes the focus, so a paste lands in it, and Enter imports the address into an inbox note that opens", async ({
    page,
    stack,
  }) => {
    const asked = await serveFetch(page, (route) =>
      route.fulfill({ json: { url: ADDRESS, html: PAGE } }),
    );
    const { dialog, field } = await openPrompt(page);
    await expect(field).toBeFocused();

    await page.keyboard.insertText(` ${ADDRESS} `);
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("tab", { name: "A walk in the park", selected: true }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(asked).toEqual([ADDRESS]);
    expect(await inbox(stack.vault)).toEqual(["A walk in the park.md"]);
    expect(await noteText(stack.vault, "00 Inbox/A walk in the park.md")).toContain(
      `resource: "${ADDRESS}"`,
    );
  });

  test("closes on Escape and fetches nothing", async ({ page, stack }) => {
    const asked = await serveFetch(page, (route) =>
      route.fulfill({ json: { url: ADDRESS, html: PAGE } }),
    );
    const { dialog } = await openPrompt(page);
    await page.keyboard.insertText(ADDRESS);

    await page.keyboard.press("Escape");

    await expect(dialog).toHaveCount(0);
    expect(asked).toEqual([]);
    expect(await inbox(stack.vault)).toEqual([]);
  });

  test("an empty Enter does nothing, and an address that is not http or https is refused with the rule", async ({
    page,
  }) => {
    const asked = await serveFetch(page, (route) =>
      route.fulfill({ json: { url: ADDRESS, html: PAGE } }),
    );
    const { dialog, status } = await openPrompt(page);

    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(status).toHaveText("");

    await page.keyboard.insertText("file:///etc/passwd");
    await page.keyboard.press("Enter");
    await expect(status).toHaveText("paste an http or https address");
    await expect(dialog).toBeVisible();
    expect(asked).toEqual([]);
  });

  test("says it is reading, and a second Enter while it reads sends no second fetch", async ({
    page,
  }) => {
    let held: Route | undefined;
    const asked = await serveFetch(page, async (route) => {
      held ??= route;
      if (held !== route) await fail("a second read")(route);
    });
    const { status } = await openPrompt(page);
    await page.keyboard.insertText(ADDRESS);

    await page.keyboard.press("Enter");
    await expect(status).toHaveText("Reading the page…");
    await expect.poll(() => asked.length).toBe(1);
    await page.keyboard.press("Enter");

    // Once the first read fails, a second fetch the Enter had sent would have arrived by now.
    await fail("That page is too big to read")(held as Route);
    await expect(status).toHaveText("That page is too big to read");
    expect(asked).toEqual([ADDRESS]);
  });

  test("a read that fails stays open with the backend's reason, and Enter tries again", async ({
    page,
    stack,
  }) => {
    const asked = await serveFetch(page, fail("That page is too big to read"));
    const { dialog, field, status } = await openPrompt(page);
    await page.keyboard.insertText(ADDRESS);

    await page.keyboard.press("Enter");
    await expect(status).toHaveText("That page is too big to read");
    await expect(dialog).toBeVisible();
    await expect(field).toHaveValue(ADDRESS);

    await page.keyboard.press("Enter");
    await expect.poll(() => asked.length).toBe(2);
    expect(await inbox(stack.vault)).toEqual([]);
  });
});
