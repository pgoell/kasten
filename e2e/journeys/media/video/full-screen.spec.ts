import type { Page } from "@playwright/test";
import { openApp, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { fakeYouTube } from "../../../harness/youtube.ts";

const lecture = "01 Notes/Lecture.md";
const pane = "[data-video-pane]";
const box = "[data-video-box]";

/** Opens the note with the video beside it by the palette, which works with vim on or off. */
async function watch(page: Page, note = lecture): Promise<void> {
  await page.goto(`/?note=${encodeURIComponent(note)}`);
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /Watch this note's video beside it/ }).first().click();
  await expect(page.locator(`${pane}:focus`)).toHaveCount(1);
}

/** What the page's full-screen element is: the box, another element, or none. */
const fullIs = (page: Page) =>
  page.evaluate((sel) => {
    const full = document.fullscreenElement;
    if (full === null) return "none";
    return full === document.querySelector(sel) ? "box" : "other";
  }, box);

/** Whether the focus sits on the box, on the pane itself, or elsewhere. */
const focusIs = (page: Page) =>
  page.evaluate(
    ([b, p]) => {
      const at = document.activeElement;
      if (at === document.querySelector(b)) return "box";
      if (at === document.querySelector(p)) return "pane";
      return "elsewhere";
    },
    [box, pane],
  );

/** The commands the fake player was sent, by name. */
async function got(page: Page): Promise<string[]> {
  const frame = page.frames().find((f) => f.url().includes("/embed/"));
  return frame === undefined ? [] : frame.evaluate(() => (window as { got?: string[] }).got ?? []);
}

/** The browser's own way out, Esc's included: no key event reaches the page, only the change. */
const browserExit = (page: Page) => page.evaluate(() => document.exitFullscreen());

const headerButton = (page: Page) =>
  page.locator(`${pane} header`).getByRole("button", { name: "Full screen", exact: true });
const exitButton = (page: Page) => page.getByRole("button", { name: "Exit full screen" });

test.beforeEach(async ({ page }) => {
  expect(await fakeYouTube(page)).toEqual([]);
});

test("#914 A1 Full screen in the header makes the player box full screen, with the frame and the shield in it", async ({
  page,
}) => {
  await watch(page);
  await headerButton(page).click();

  await expect.poll(() => fullIs(page)).toBe("box");
  const held = await page.evaluate(() => {
    const full = document.fullscreenElement;
    return [
      full?.contains(document.querySelector('iframe[title="video"]')),
      full?.contains(document.querySelector("[data-video-shield]")),
    ];
  });
  expect(held).toEqual([true, true]);
  await expect(headerButton(page)).toHaveAttribute("aria-pressed", "true");
});

for (const vim of ["on", "off"]) {
  test(`#914 A2 f over the pane goes full screen, with vim ${vim}`, async ({ page }) => {
    await page.addInitScript((v) => localStorage.setItem("kasten.vim", v), vim);
    await watch(page);
    await page.keyboard.press("f");

    await expect.poll(() => fullIs(page)).toBe("box");
  });
}

test("#914 A3 A4 full screen, the focus is in the box, and k and a click on the shield each reach the player", async ({
  page,
}) => {
  await watch(page);
  await page.keyboard.press("f");
  await expect.poll(() => fullIs(page)).toBe("box");
  await expect.poll(() => focusIs(page)).toBe("box");

  await page.keyboard.press("k");
  await expect.poll(() => got(page)).toEqual(["playVideo"]);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect.poll(() => got(page)).toEqual(["playVideo", "pauseVideo"]);
  expect(await fullIs(page)).toBe("box");
  expect(await focusIs(page)).toBe("box");
});

test("#1395 A5 full screen, ArrowUp, ArrowDown and m set the volume and mute", async ({ page }) => {
  await watch(page);
  await page.keyboard.press("f");
  await expect.poll(() => focusIs(page)).toBe("box");
  for (const key of ["ArrowUp", "ArrowDown", "ArrowDown", "m"]) await page.keyboard.press(key);

  await expect.poll(() => got(page)).toEqual(["setVolume", "setVolume", "setVolume", "mute"]);
  expect(await fullIs(page)).toBe("box");
});

test("#914 A5 the browser's exit takes the exit button away and gives the focus back to the pane", async ({
  page,
}) => {
  await watch(page);
  await page.keyboard.press("f");
  await expect(exitButton(page)).toBeVisible();
  await browserExit(page);

  await expect(exitButton(page)).toHaveCount(0);
  await expect.poll(() => focusIs(page)).toBe("pane");
  await expect(headerButton(page)).toHaveAttribute("aria-pressed", "false");
});

test("#914 A5 f again and Exit full screen on the player each leave full screen", async ({
  page,
}) => {
  await watch(page);
  await page.keyboard.press("f");
  await expect.poll(() => fullIs(page)).toBe("box");
  await page.keyboard.press("f");
  await expect.poll(() => fullIs(page)).toBe("none");
  await expect.poll(() => focusIs(page)).toBe("pane");

  await page.keyboard.press("f");
  await expect.poll(() => fullIs(page)).toBe("box");
  await exitButton(page).click();
  await expect.poll(() => fullIs(page)).toBe("none");
  await expect.poll(() => focusIs(page)).toBe("pane");
});

test("#914 I1 R2 full screen, Space opens no which-key panel, and Space k leaves full screen before it runs", async ({
  page,
}) => {
  await watch(page);
  await page.keyboard.press("f");
  await expect.poll(() => focusIs(page)).toBe("box");
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await fullIs(page)).toBe("box");

  await page.keyboard.press("k");
  await expect.poll(() => fullIs(page)).toBe("none");
});

/** Holds the browser's exit back, as a slow screen does, so a command run before it ends shows. */
const heldExit = (page: Page) =>
  page.addInitScript(() => {
    const exit = Document.prototype.exitFullscreen;
    Document.prototype.exitFullscreen = function (this: Document) {
      return new Promise((done) => setTimeout(done, 300)).then(() => exit.call(this));
    };
  });

/** Full screen by f, then the keys typed blind, one by one. */
async function typedFull(page: Page, keys: string[]): Promise<void> {
  await page.keyboard.press("f");
  await expect.poll(() => focusIs(page)).toBe("box");
  for (const key of keys) await page.keyboard.press(key);
  await expect.poll(() => fullIs(page)).toBe("none");
}

for (const vim of ["on", "off"]) {
  test(`#914 R2 #2160 Space k typed full screen lands in the note's editor, with vim ${vim}`, async ({
    page,
  }) => {
    await page.addInitScript((v) => localStorage.setItem("kasten.vim", v), vim);
    await watch(page);
    await typedFull(page, ["Space", "k"]);

    await expect(page.locator(".cm-content").first()).toBeFocused();
  });
}

test("#2160 Space k lands in the note's editor when the browser's exit settles late", async ({
  page,
}) => {
  await heldExit(page);
  await watch(page);
  await typedFull(page, ["Space", "k"]);

  await expect(page.locator(".cm-content").first()).toBeFocused();
});

test("#2160 Space f f typed full screen opens the finder with its input focused", async ({
  page,
}) => {
  await watch(page);
  await typedFull(page, ["Space", "f", "f"]);

  await expect(page.getByRole("dialog", { name: "Find note" }).locator("input")).toBeFocused();
});

test("#2160 Space a moves no focus, so after the exit the focus is on the pane", async ({
  page,
}) => {
  await watch(page);
  await typedFull(page, ["Space", "a"]);

  await expect.poll(() => focusIs(page)).toBe("pane");
});

test("#2160 Space c b typed full screen still opens the file chooser", async ({ page }) => {
  await watch(page);
  const chooser = page.waitForEvent("filechooser");
  await typedFull(page, ["Space", "c", "b"]);

  await chooser;
});

test("#914 I1 full screen, Space q closes the video pane", async ({ page }) => {
  await watch(page);
  await page.keyboard.press("f");
  await expect.poll(() => focusIs(page)).toBe("box");
  await page.keyboard.press("Space");
  await page.keyboard.press("q");

  await expect(page.locator(pane)).toHaveCount(0);
  await expect.poll(() => fullIs(page)).toBe("none");
});

test("#914 R1 Space then the browser's exit drops the unseen leader, so k after it plays the video", async ({
  page,
}) => {
  await watch(page);
  await page.keyboard.press("f");
  await expect.poll(() => focusIs(page)).toBe("box");
  await page.keyboard.press("Space");
  await browserExit(page);
  await expect.poll(() => focusIs(page)).toBe("pane");
  await page.keyboard.press("k");

  await expect.poll(() => got(page)).toEqual(["playVideo"]);
  // Space k would have moved the focus up a pane.
  expect(await focusIs(page)).toBe("pane");
});

test("#914 I4 f with a leader pending is the leader's, and a bare f after it goes full screen", async ({
  page,
}) => {
  await watch(page);
  await page.keyboard.press("Space");
  await page.keyboard.press("f");
  await page.keyboard.press("f");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await expect(finder).toBeVisible();
  expect(await fullIs(page)).toBe("none");
  await page.keyboard.press("Escape");
  await expect(finder).toHaveCount(0);
  await expect.poll(() => focusIs(page)).toBe("pane");

  await page.keyboard.press("f");
  await expect.poll(() => fullIs(page)).toBe("box");
});

test("#914 I5 Ctrl f and Cmd f are left to the browser, and a bare f goes full screen", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const seen: boolean[] = [];
    (window as { seen?: boolean[] }).seen = seen;
    addEventListener("keydown", (event) => {
      if (event.key === "f") seen.push(event.defaultPrevented);
    });
  });
  await watch(page);
  await page.keyboard.press("Control+f");
  await page.keyboard.press("Meta+f");
  expect(await fullIs(page)).toBe("none");

  await page.keyboard.press("f");
  await expect.poll(() => fullIs(page)).toBe("box");
  expect(await page.evaluate(() => (window as { seen?: boolean[] }).seen)).toEqual([
    false,
    false,
    true,
  ]);
});

test("#914 I2 a refused request leaves the pane as it was, with no exit button and no error", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () =>
      Promise.reject(new TypeError("Permissions check failed"));
  });
  await watch(page);
  await headerButton(page).click();

  await expect.poll(() => focusIs(page)).toBe("pane");
  await expect(exitButton(page)).toHaveCount(0);
  await expect(headerButton(page)).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("#914 I3 a note with no video has no Full screen button and f does nothing", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { "01 Notes/Plain.md": "# No video here\n" });
  await watch(page, "01 Notes/Plain.md");
  await expect(page.locator(pane).getByRole("status")).toHaveText("No video linked in this note");
  await page.keyboard.press("f");

  await expect(headerButton(page)).toHaveCount(0);
  expect(await fullIs(page)).toBe("none");
});

test.describe("on a phone", () => {
  test.use(phone);

  /** Opens the note and the video beside it by taps, as a phone has no keys. */
  async function watchByTap(page: Page): Promise<void> {
    await page.goto(`/?note=${encodeURIComponent(lecture)}`);
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /Watch this note's video beside it/ }).first().tap();
    await expect(page.locator(box)).toBeVisible();
  }

  test("#914 A7 a tap on Full screen goes full screen, and a tap on Exit full screen leaves it", async ({
    page,
  }) => {
    await watchByTap(page);
    await headerButton(page).tap();
    await expect.poll(() => fullIs(page)).toBe("box");

    await exitButton(page).tap();
    await expect.poll(() => fullIs(page)).toBe("none");
    await expect.poll(() => focusIs(page)).toBe("pane");
  });

  test("#2160 a keyboard's Space f f in full screen by a tap opens the finder as it does outside", async ({
    page,
  }) => {
    await watchByTap(page);
    const input = page.getByRole("dialog", { name: "Find note" }).locator("input");
    await page.locator(pane).focus();
    for (const key of ["Space", "f", "f"]) await page.keyboard.press(key);
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);

    await headerButton(page).tap();
    await expect.poll(() => focusIs(page)).toBe("box");
    for (const key of ["Space", "f", "f"]) await page.keyboard.press(key);
    await expect.poll(() => fullIs(page)).toBe("none");
    await expect(input).toBeFocused();
  });

  test("#914 A7 where the browser has no full screen for a box, no button is drawn and f does nothing", async ({
    page,
  }) => {
    // Safari on an iPhone: full screen only for a video element, never a box.
    await page.addInitScript(() =>
      Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false }),
    );
    await watchByTap(page);
    await page.locator(pane).focus();
    await page.keyboard.press("f");

    await expect(page.locator(`${pane} header`).getByRole("button", { name: "Mute" })).toBeVisible();
    await expect(headerButton(page)).toHaveCount(0);
    expect(await fullIs(page)).toBe("none");
  });
});


