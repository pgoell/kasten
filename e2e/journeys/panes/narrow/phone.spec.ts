import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { phone } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { bothTexts, OUTSIDE, sign, welcome } from "../conflict/conflicted.ts";

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Commands" });

/** Loads the app and waits for the editor of the note it opens on. */
async function load(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
}

/** A tap on the sheet around a panel, clear of the panel, which is its way out. */
async function tapSheet(sheet: Locator) {
  const box = await sheet.boundingBox();
  // The bottom corner: a phone's search panel fills the top of the screen.
  await sheet.tap({ position: { x: 4, y: (box?.height ?? 8) - 4 } });
}

test.describe("the toolbar under a mouse", () => {
  test("a wide window has none, and a narrow one keeps its keys and its rail instead", async ({
    page,
  }) => {
    await load(page);
    await expect(toolbar(page)).toHaveCount(0);

    await page.setViewportSize({ width: 700, height: 800 });
    await expect
      .poll(async () => [
        await toolbar(page).count(),
        await page.getByRole("button", { name: "Show file tree" }).count(),
      ])
      .toEqual([0, 1]);
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("the toolbar shows with no pane to move to, and goes on a tablet's width", async ({
    page,
  }) => {
    await load(page);
    await expect
      .poll(async () => [
        await toolbar(page).isVisible(),
        await page.getByRole("button", { name: "Move to the next pane" }).count(),
      ])
      .toEqual([true, 0]);

    // A finger, and room for the panel beside the note.
    await page.setViewportSize({ width: 1024, height: 896 });
    await expect(toolbar(page)).toHaveCount(0);
  });

  test("the toolbar opens the palette, the finder and the search, and a tap on each sheet shuts it", async ({
    page,
  }) => {
    await load(page);
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    const palette = page.getByRole("dialog", { name: "Run a command" });
    // The way to vim's keys on a phone, which no key reaches with vim off.
    await expect(palette.getByRole("option", { name: "Toggle vim keys" })).toBeVisible();
    await tapSheet(palette);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Find a note" }).tap();
    await tapSheet(page.getByRole("dialog", { name: "Find note" }));
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Search note content" }).tap();
    // The search fills a phone's screen, so no finger reaches its backdrop (#1782): the press goes there itself.
    const search = page.getByRole("dialog", { name: "Search notes" });
    for (const type of ["mousedown", "mouseup", "click"]) await search.dispatchEvent(type);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the palette lists the accent rows, and a tap on one turns the page and stores it", async ({
    page,
  }) => {
    await load(page);
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: "Accent palette: Hay's russet" }).tap();

    await expect
      .poll(() =>
        page.evaluate(() => [
          document.documentElement.dataset.palette,
          localStorage.getItem("kasten.palette"),
        ]),
      )
      .toEqual(["russet", "russet"]);
  });

  test("the frame makes room for a keyboard that covers the page, the bar and toolbar inside it", async ({
    page,
  }) => {
    // Headless Chromium draws no keyboard, so the visual viewport is one the page can shrink.
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), {
        scale: 1,
        offsetTop: 0,
        height: window.innerHeight,
      });
      Object.defineProperty(window, "visualViewport", { value: viewport });
    });
    await load(page);
    const frame = page.getByRole("main");
    await expect(frame).toHaveCSS("padding-bottom", "0px");

    await page.evaluate(() => {
      const viewport = window.visualViewport as unknown as EventTarget & { height: number };
      viewport.height = window.innerHeight - 300;
      viewport.dispatchEvent(new Event("resize"));
    });

    await expect
      .poll(async () => [
        await frame.evaluate((main) => main.style.paddingBottom),
        await frame.locator("footer").count(),
        await frame.getByRole("toolbar", { name: "Commands" }).count(),
      ])
      .toEqual(["300px", 1, 1]);
  });

  test("a conflict shows the diff, with both buttons under the part that scrolls, and writes nothing", async ({
    page,
    stack,
  }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let puts = 0;
    await page.route(
      (url) => decodeURIComponent(url.pathname) === "/api/files/Welcome.md",
      async (route) => {
        if (route.request().method() !== "PUT") return route.fallback();
        puts += 1;
        await held;
        await route.fallback();
      },
    );
    await load(page);
    await page.getByRole("button", { name: "File tree", exact: true }).tap();
    await page
      .getByRole("navigation", { name: "Vault" })
      .getByRole("button", { name: "Welcome", exact: true })
      .tap();
    const editor = page.locator(".cm-content", { hasText: "front door" });
    await editor.tap();
    await expect(editor).toBeFocused();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\ntyped here");
    await expect.poll(() => puts).toBeGreaterThan(0);
    await writeFile(join(stack.vault, "Welcome.md"), OUTSIDE);
    release();

    const diff = page.getByTestId("conflict-diff");
    await expect
      .poll(
        async () => [
          await sign(page).getAttribute("aria-label"),
          (await diff.count()) > 0 ? await diff.textContent() : null,
          await welcome(stack.vault),
        ],
        { timeout: 15_000 },
      )
      .toEqual(["Changed on disk", bothTexts("Somebody else wrote this."), OUTSIDE]);
    // Under the part that scrolls, not in it: a long diff on a small screen would carry the
    // only way out off the top of the panel.
    const inScroller = await diff.evaluate((element) => {
      const scroller = element.closest(".overflow-y-auto");
      if (scroller === null) return null;
      return ["Write my text", "Take the vault's"].map((name) =>
        [...scroller.querySelectorAll("button")].some((b) => b.textContent === name),
      );
    });
    expect(inScroller).toEqual([false, false]);
    await expect(page.getByRole("button", { name: "Write my text" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Take the vault's" })).toBeVisible();
  });
});
