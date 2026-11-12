import type { Page } from "@playwright/test";
import { openApp, phone, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const DOT =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Only a viewBox for its size, a style block, a style attribute and a data: picture, beside two ways to run script. */
const LOGO = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Drawn by hand -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"
  onload="document.documentElement.setAttribute('data-onload', 'ran'); fetch('/svg-ran-onload')">
  <style>rect { fill: #c33; }</style>
  <script>document.documentElement.setAttribute('data-script', 'ran'); fetch('/svg-ran-script')</script>
  <rect width="40" height="20" style="stroke: #000"/>
  <image href="data:image/png;base64,${DOT}" width="4" height="4"/>
</svg>
`;

const NOTE = "# Pictures\n\nA drawing:\n\n![[logo.svg]]\n\nThe same one:\n\n![](pics/logo.svg)\n";

/** Every request a script in the svg would send, so a test can say none went. */
function ranRequests(page: Page): string[] {
  const ran: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/svg-ran")) ran.push(request.url());
  });
  return ran;
}

async function seeded(vault: string): Promise<void> {
  await vaultWith(vault, { "pics/logo.svg": LOGO, "01 Notes/Pictures.md": NOTE });
}

/** Opens the note by its address, the one way in that holds with vim on, off and on a phone. */
async function openPictures(page: Page): Promise<void> {
  await page.goto(`/?note=${encodeURIComponent("01 Notes/Pictures.md")}`);
  await expect(page.getByText("A drawing:")).toBeVisible({ timeout: 15_000 });
}

/** Both embeds draw the svg as a loaded `<img>` with a box above zero. */
async function expectDrawn(page: Page): Promise<void> {
  const pictures = page.locator('.cm-content img[src$="/api/assets/pics/logo.svg"]');
  await expect(pictures).toHaveCount(2);
  for (const picture of await pictures.all()) {
    await expect(picture).toBeVisible();
    await expect
      .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    const box = await picture.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  }
}

test("an svg draws in live preview as a picture whose script never runs", async ({
  page,
  stack,
}) => {
  await seeded(stack.vault);
  const ran = ranRequests(page);
  await openPictures(page);

  await expectDrawn(page);
  await page.screenshot({ path: test.info().outputPath("svg-desktop.png") });
  expect(ran).toEqual([]);
});

test("an svg opens from the file tree in the image pane", async ({ page, stack }) => {
  await seeded(stack.vault);
  const ran = ranRequests(page);
  await openApp(page);

  await page.getByRole("button", { name: "pics", exact: true }).click();
  await page.getByRole("button", { name: "logo.svg", exact: true }).click();

  const picture = page.locator("[data-pane]").getByRole("img", { name: "logo.svg" });
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(ran).toEqual([]);
});

test.describe("opened as a page of its own", () => {
  const marks = (page: Page) =>
    page.evaluate(() => ({
      root: document.documentElement.localName,
      script: document.documentElement.getAttribute("data-script"),
      onload: document.documentElement.getAttribute("data-onload"),
    }));

  test("its script and its onload handler run neither", async ({ page, stack }) => {
    await seeded(stack.vault);

    const answer = await page.goto("/api/assets/pics/logo.svg");

    expect(answer?.status()).toBe(200);
    expect(answer?.headers()["content-type"]).toBe("image/svg+xml");
    await page.waitForLoadState("load");
    expect(await marks(page)).toEqual({ root: "svg", script: null, onload: null });
  });

  test("the same svg without the policy runs both, so the test above can fail", async ({
    page,
    stack,
  }) => {
    await seeded(stack.vault);
    await page.route("**/api/assets/pics/logo.svg", async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["content-security-policy"];
      await route.fulfill({ response, headers });
    });

    await page.goto("/api/assets/pics/logo.svg");

    await expect.poll(() => marks(page)).toEqual({ root: "svg", script: "ran", onload: "ran" });
  });
});

test.describe("with vim off", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  });

  test("an svg draws in live preview as a picture", async ({ page, stack }) => {
    await seeded(stack.vault);
    const ran = ranRequests(page);
    await openPictures(page);

    await expectDrawn(page);
    expect(ran).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("an svg draws in live preview at 414 px", async ({ page, stack }) => {
    await seeded(stack.vault);
    const ran = ranRequests(page);
    await openPictures(page);

    await expectDrawn(page);
    await page.screenshot({ path: test.info().outputPath("svg-phone.png") });
    expect(ran).toEqual([]);
  });
});
