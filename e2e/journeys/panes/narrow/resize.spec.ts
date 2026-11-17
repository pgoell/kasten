import type { Page } from "@playwright/test";
import {
  leader,
  openApp,
  openNote,
  PANE,
  panes,
  phone,
  readAll,
  tapHeight,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { COARSE, FINE, saved, seed } from "../workspace/stored.ts";

const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });
const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 700, height: 800 };

/** The style of each pane on screen that places it: `top` when stacked, `left` side by side. */
const placed = (page: Page, side: "top" | "left") =>
  readAll(page, PANE, (all, key) => all.map((pane) => pane.style[key]), side);

test.describe("a live window narrowed and widened again", () => {
  test("the open tree shuts under the narrow window and comes back as the wide one left it, open in the store throughout", async ({
    page,
  }) => {
    await openApp(page);
    await expect
      .poll(async () => [await tree(page).isVisible(), await saved(page)])
      .toEqual([true, expect.objectContaining({ treeOpen: true })]);

    await page.setViewportSize(NARROW);
    await expect
      .poll(async () => [
        await tree(page).isVisible(),
        await page.getByRole("button", { name: "Close file tree" }).count(),
        await saved(page),
      ])
      .toEqual([false, 0, expect.objectContaining({ treeOpen: true })]);

    await page.setViewportSize(WIDE);
    await expect
      .poll(async () => [await tree(page).isVisible(), await saved(page)])
      .toEqual([true, expect.objectContaining({ treeOpen: true })]);
    await page.reload();
    await expect(tree(page)).toBeVisible({ timeout: 15_000 });
  });

  test("a tree shut by key in the wide window stays shut through the narrow one, and in the store", async ({
    page,
  }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "b");
    await expect
      .poll(async () => [await tree(page).isVisible(), await saved(page)])
      .toEqual([false, expect.objectContaining({ treeOpen: false })]);

    await page.setViewportSize(NARROW);
    await page.setViewportSize(WIDE);
    await expect
      .poll(async () => [await tree(page).isVisible(), await saved(page)])
      .toEqual([false, expect.objectContaining({ treeOpen: false })]);
  });

  test("a split stacks in the narrow window, counts its panes in the bar, and stands side by side once widened", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await page.goto("/");
    const editor = page.locator(".cm-content").first();
    await editor.click({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pane-shown")).toHaveCount(0);

    await leader(page, "%");
    await expect
      .poll(async () => [
        await placed(page, "top"),
        await page.getByTestId("pane-shown").textContent(),
        await page.locator(".cm-content:focus").count(),
      ])
      .toEqual([["0px", "calc(50% + 1px)"], "pane 2/2", 1]);

    await leader(page, "o");
    await expect
      .poll(async () => [
        await panes(page).count(),
        await page.getByTestId("pane-shown").textContent(),
      ])
      .toEqual([2, "pane 1/2"]);

    await page.setViewportSize(WIDE);
    await expect
      .poll(async () => [await placed(page, "left"), await page.getByTestId("pane-shown").count()])
      .toEqual([["0px", "calc(50% + 1px)"], 0]);
    await page.setViewportSize(NARROW);
    await expect
      .poll(async () => [await placed(page, "top"), await placed(page, "left")])
      .toEqual([
        ["0px", "calc(50% + 1px)"],
        ["0px", "0px"],
      ]);
  });
});

test.describe("a split in a narrow window (#793)", () => {
  /** Each drawn pane's box against the frame's, whether it has a header row, and whether its focus line is lit. */
  const stack = (page: Page) =>
    readAll(page, PANE, (all) =>
      all.map((pane) => {
        const box = pane.getBoundingClientRect();
        const frame = (pane.parentElement as HTMLElement).getBoundingClientRect();
        const line = pane.querySelector("[data-focus-line]");
        return {
          id: pane.getAttribute("data-pane"),
          left: box.left - frame.left,
          right: frame.right - box.right,
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          header: pane.querySelector("[data-pane-header]") !== null,
          lit: line !== null && getComputedStyle(line).backgroundColor !== "rgba(0, 0, 0, 0)",
        };
      }),
    );
  const lit = async (page: Page) => (await stack(page)).map((pane) => pane.lit);

  async function split(page: Page) {
    await page.setViewportSize(NARROW);
    await page.goto("/");
    await page.locator(".cm-content").first().click({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    const [whole] = await stack(page);
    await leader(page, "%");
    await expect(panes(page)).toHaveCount(2);
    return whole;
  }

  test("A5 draws both panes full width, one above the other, each under its header", async ({
    page,
  }) => {
    const { top, bottom } = (await split(page)) ?? { top: 0, bottom: 0 };
    // Each half the height, less the 2 px rule between them.
    const half = (from: number, to: number) => ({ left: 0, right: 0, top: from, bottom: to });
    const mid = (top + bottom) / 2;
    await expect
      .poll(() => stack(page))
      .toEqual([
        expect.objectContaining({ ...half(top, mid - 1), header: true }),
        expect.objectContaining({ ...half(mid + 1, bottom), header: true }),
      ]);
  });

  test("I1 a click in a pane focuses it, and closing one gives the other the whole height", async ({
    page,
  }) => {
    const whole = await split(page);
    await page.locator(PANE).nth(0).locator(".cm-content").click();
    await expect.poll(() => lit(page)).toEqual([true, false]);
    await expect(page.getByTestId("pane-shown")).toHaveText("pane 1/2");
    await page.locator(PANE).nth(1).locator(".cm-content").click();
    await expect.poll(() => lit(page)).toEqual([false, true]);
    await expect(page.getByTestId("pane-shown")).toHaveText("pane 2/2");

    await page.keyboard.press("Escape");
    await leader(page, "q");
    await expect
      .poll(() => stack(page))
      .toEqual([
        expect.objectContaining({ top: whole?.top, bottom: whole?.bottom, header: false }),
      ]);
  });

  test.describe("under a finger", () => {
    test.use(phone);

    async function splitByPalette(page: Page) {
      await page.goto("/");
      await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Run a command by name" }).tap();
      await page.getByRole("option", { name: /^Split the pane left and right/ }).tap();
      await expect(panes(page)).toHaveCount(2);
    }

    test("I1 the toolbar's pane button moves the focus between the stacked panes", async ({
      page,
    }) => {
      await splitByPalette(page);
      await expect.poll(() => lit(page)).toEqual([true, false]);
      await page.getByRole("button", { name: "Move to the next pane" }).tap();
      await expect.poll(() => lit(page)).toEqual([false, true]);
    });

    test("I1 with the keyboard up the focused pane takes the whole height, and both come back once it goes", async ({
      page,
    }) => {
      // Headless Chromium draws no keyboard, so the visual viewport is one the page can shrink.
      await page.addInitScript(() => {
        const viewport = Object.assign(new EventTarget(), { scale: 1, offsetTop: 0 });
        Object.defineProperty(viewport, "height", { value: innerHeight, writable: true });
        Object.defineProperty(window, "visualViewport", { value: viewport });
      });
      await splitByPalette(page);
      const resize = (by: number) =>
        page.evaluate((less) => {
          const viewport = window.visualViewport as unknown as EventTarget & { height: number };
          viewport.height = innerHeight - less;
          viewport.dispatchEvent(new Event("resize"));
        }, by);

      await page.getByRole("button", { name: "Move to the next pane" }).tap();
      await expect.poll(() => lit(page)).toEqual([false, true]);
      const [upper, lower] = await stack(page);

      await resize(300);
      await expect
        .poll(() => stack(page))
        .toEqual([expect.objectContaining({ id: lower?.id, top: upper?.top, header: false })]);
      await resize(0);
      await expect.poll(() => lit(page)).toEqual([false, true]);
    });
  });
});

test.describe("the tab strip at each width", () => {
  const NAMES = [...Array(8).keys()].map((n) => `a note whose name runs long ${n}`);
  const more = (page: Page) => page.getByRole("button", { name: /^\d+ more$/ });
  const tabs = (page: Page) => page.getByRole("tab");
  const list = (page: Page) => page.getByRole("tablist");

  /** Loads the app on eight tabs, one note each, the last active, under the pointer's own key. */
  async function eight(page: Page, vault: string, key: string) {
    await vaultWith(vault, Object.fromEntries(NAMES.map((name) => [`${name}.md`, "text\n"])));
    const all = NAMES.map((name, n) => ({
      id: `t${n}`,
      root: { id: `p${n}`, path: `${name}.md` },
      focus: `p${n}`,
    }));
    await seed(page, {
      [key]: JSON.stringify({ layout: { tabs: all, active: 7 }, treeOpen: false }),
    });
    await page.goto("/");
    await expect(page.getByRole("tab", { name: NAMES[7], selected: true })).toBeVisible({
      timeout: 15_000,
    });
  }

  /** Whether the tab is wholly inside the row's box, as the row has scrolled it. */
  async function inRow(page: Page, name: string) {
    const [row, tab] = await Promise.all([
      list(page).boundingBox(),
      page.getByRole("tab", { name }).boundingBox(),
    ]);
    return !!row && !!tab && tab.x >= row.x - 1 && tab.x + tab.width <= row.x + row.width + 1;
  }

  test.describe("on a phone", () => {
    test.use(phone);

    test("every tab is drawn with no N more, the active one in the row, a wrap to the first scrolls back, and the text is 15 px", async ({
      page,
      stack,
    }) => {
      await eight(page, stack.vault, COARSE);
      await expect(tabs(page)).toHaveCount(8);
      await expect(more(page)).toHaveCount(0);
      await expect.poll(() => inRow(page, NAMES[7])).toBe(true);
      expect(
        await list(page).evaluate((row) => [row.scrollLeft > 0, getComputedStyle(row).fontSize]),
      ).toEqual([true, "15px"]);

      await page.getByRole("button", { name: "Run a command by name" }).tap();
      await page.getByRole("option", { name: "Go to the next tab" }).tap();
      await expect(page.getByRole("tab", { name: NAMES[0], selected: true })).toBeVisible();
      await expect.poll(() => list(page).evaluate((row) => row.scrollLeft)).toBe(0);
    });

    test("the strip ends in a 44 px + named New note that opens the New note prompt, and folds once wide and not again once narrow", async ({
      page,
      stack,
    }) => {
      await eight(page, stack.vault, COARSE);
      const plus = page.getByRole("button", { name: "New note" });
      await expect(plus).toHaveText("");
      await expect(plus.locator("svg")).toBeVisible();
      expect((await plus.boundingBox())?.width).toBe(44);
      await plus.tap();
      await expect(page.getByRole("dialog", { name: "New note" })).toBeVisible();
      await page.keyboard.press("Escape");

      await page.setViewportSize(WIDE);
      await expect(more(page)).toBeVisible();
      await page.setViewportSize({ width: 414, height: 896 });
      await expect(tabs(page)).toHaveCount(8);
      await expect(more(page)).toHaveCount(0);
    });
  });

  test("a narrow window with a mouse still folds the tabs behind N more", async ({
    page,
    stack,
  }) => {
    await page.setViewportSize(NARROW);
    await eight(page, stack.vault, FINE);
    await expect(more(page)).toBeVisible();
    expect(await tabs(page).count()).toBeLessThan(8);
  });

  test("a wide window folds behind N more, and its top bar's New note, not the strip, makes a note", async ({
    page,
    stack,
  }) => {
    await eight(page, stack.vault, FINE);
    await expect(more(page)).toBeVisible();
    const button = page.getByRole("button", { name: "New note", exact: true });
    await expect(button).toHaveCount(1);
    await expect(button).toHaveText("New note");
    await button.click();
    await expect(page.getByRole("dialog", { name: "New note" })).toBeVisible();
  });

  test.describe("under a finger in a wide window", () => {
    test.use({ ...phone, viewport: WIDE });

    test("the top bar's search field is 13 px and at least 44 px tall", async ({ page, stack }) => {
      await eight(page, stack.vault, COARSE);
      const search = page.getByRole("button", { name: /^Search \d+ notes$/ });
      expect(await search.evaluate((field) => getComputedStyle(field).fontSize)).toBe("13px");
      expect(await tapHeight(search)).toBeGreaterThanOrEqual(44);
    });
  });
});
