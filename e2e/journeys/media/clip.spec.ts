import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { openApp, phone, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const NOTE = "# Clips\n\nThe walk:\n\n![[walk.mp4]]\n\n![[swim.webm]]\n\n[[walk.mp4]] opens it.\n";

/** Two four-second clips, VP9 in mp4 and in webm, since the test browser has no H.264. */
async function seeded(vault: string): Promise<void> {
  const clip = (name: string) => readFile(join(import.meta.dirname, "clips", name));
  await vaultWith(vault, {
    "clips/walk.mp4": await clip("walk.mp4"),
    "clips/swim.webm": await clip("swim.webm"),
    "01 Notes/Clips.md": NOTE,
  });
}

async function openClips(page: Page): Promise<void> {
  await page.goto(`/?note=${encodeURIComponent("01 Notes/Clips.md")}`);
  await expect(page.getByText("The walk:")).toBeVisible({ timeout: 15_000 });
}

/** Every status the server gave a ranged request for a clip, so a test can say seeking read by range. */
function rangedAnswers(page: Page): number[] {
  const statuses: number[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (/\/api\/assets\/clips\//.test(request.url()) && request.headers().range !== undefined) {
      statuses.push(response.status());
    }
  });
  return statuses;
}

/** Plays the clip, pauses it, seeks to 3 s and reads back where it stands. Never autoplayed first. */
async function playAndSeek(video: Locator): Promise<void> {
  await expect(video).toHaveJSProperty("autoplay", false);
  await expect(video).toHaveJSProperty("controls", true);
  await expect(video).toHaveJSProperty("paused", true);
  await expect(video).toHaveJSProperty("currentTime", 0);
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
    element.pause();
    await new Promise((done) => {
      element.addEventListener("seeked", done, { once: true });
      element.currentTime = 3;
    });
  });
  await expect(video).toHaveJSProperty("duration", 4);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(3, 0);
}

test("an mp4 and a webm play and seek in live preview, read by range", async ({ page, stack }) => {
  await seeded(stack.vault);
  const ranged = rangedAnswers(page);
  await openClips(page);

  const players = page.locator(".cm-embed-clip video.cm-clip");
  await expect(players).toHaveCount(2);
  await playAndSeek(players.nth(0));
  await playAndSeek(players.nth(1));
  await page.screenshot({ path: test.info().outputPath("clip-desktop.png") });

  expect(ranged.length).toBeGreaterThan(0);
  expect(ranged.every((status) => status === 206)).toBe(true);
});

test("gf on a video link opens the player in the pane", async ({ page, stack }) => {
  await seeded(stack.vault);
  await openClips(page);

  await page.keyboard.type("9Ggf");

  await expect(page.locator("[data-image-pane]")).toHaveAttribute("aria-label", "clip");
  await playAndSeek(page.locator("[data-clip] video"));
});

test("an mp4 and a webm open from the file tree as players that seek", async ({ page, stack }) => {
  await seeded(stack.vault);
  await openApp(page);

  await page.getByRole("button", { name: "clips", exact: true }).click();
  for (const name of ["walk.mp4", "swim.webm"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator("[data-clip] video")).toHaveAttribute("src", `/api/assets/clips/${name}`);
    await playAndSeek(page.locator("[data-clip] video"));
  }
});

test.describe("with vim off", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  });

  test("a video plays in live preview, and ctrl and a click on its link opens the player", async ({
    page,
    stack,
  }) => {
    await seeded(stack.vault);
    await openClips(page);

    await playAndSeek(page.locator(".cm-embed-clip video").first());
    await page.locator(".cm-wikilink", { hasText: "walk.mp4" }).click({ modifiers: ["Control"] });

    await playAndSeek(page.locator("[data-clip] video"));
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a video fits 414 px, plays and seeks, and a tap on its link opens it", async ({
    page,
    stack,
  }) => {
    await seeded(stack.vault);
    await openClips(page);

    const player = page.locator(".cm-embed-clip video").first();
    await playAndSeek(player);
    await page.screenshot({ path: test.info().outputPath("clip-phone.png") });
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(414);
    expect((await player.boundingBox())?.width ?? 999).toBeLessThanOrEqual(414);

    await page.locator(".cm-wikilink", { hasText: "walk.mp4" }).tap();
    await playAndSeek(page.locator("[data-clip] video"));
  });

  test("run, then the pick row, opens the picker on that tap and lands the file at the cursor", async ({
    page,
    stack,
  }) => {
    await seeded(stack.vault);
    await openClips(page);
    // The emulated tap moves the page's selection and not CodeMirror's; the click puts the cursor there.
    await page.getByText("The walk:").tap();
    await page.getByText("The walk:").click();
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.keyboard.type("pick");
    const row = page.getByRole("option", { name: ROW });
    await expect(row).toBeVisible();
    await shoot(page, "pick-phone");

    // Fires only for a picker the browser would really show, so it proves the tap's activation.
    const chooser = page.waitForEvent("filechooser");
    await row.tap();
    const picker = await chooser;
    expect(picker.isMultiple()).toBe(true);
    await picker.setFiles(join(import.meta.dirname, "clips", "swim.webm"));

    await landed(stack.vault, "The walk:![[swim 1.webm]]");
  });
});

const ROW = "Pick an image or video file into this note";

/** One picture in light and one in dark. */
async function shoot(page: Page, name: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: test.info().outputPath(`${name}-${colorScheme}.png`) });
  }
}

/** The vault holds a clip named `swim.webm`, so the picked one goes in beside it, numbered. */
async function landed(vault: string, line: string): Promise<void> {
  await expect
    .poll(() => readFile(join(vault, "01 Notes/Clips.md"), "utf8"), { timeout: 10_000 })
    .toContain(line);
  await access(join(vault, "99 Misc/02 Assets/01 Images/swim 1.webm"));
}

test("<leader>: and Enter on the pick row open the picker once the key is up", async ({
  page,
  stack,
}) => {
  await seeded(stack.vault);
  // A mouse and keys in a window as narrow as the phone's.
  await page.setViewportSize({ width: 414, height: 896 });
  await openClips(page);
  await page.getByText("The walk:").click();
  await page.keyboard.press("Escape");
  await page.keyboard.type(" :pick");
  await expect(page.getByRole("option", { name: ROW })).toBeVisible();
  await shoot(page, "pick-desktop");

  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(join(import.meta.dirname, "clips", "swim.webm"));

  await landed(stack.vault, "The walk:![[swim 1.webm]]");
});
