import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { panes, phone, tapHeight, today, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { bothTexts, OUTSIDE, sign, welcome } from "../conflict/conflicted.ts";
import { COARSE } from "../workspace/stored.ts";

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Commands" });

/** Loads the app and waits for the editor of the note it opens on. */
async function load(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Waits for the home view's cards above today's editor to draw their answers. Each lands late and
 * moves the editor down, so a tap aimed before then lands on a card instead (#2292).
 */
async function settled(page: Page) {
  const recent = page.locator("[data-today-column]").filter({ hasText: "Recent" });
  await expect(recent.getByRole("button").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /cards waiting$/ })).toBeVisible();
  await expect(page.getByText("Remind me to drink water")).toBeVisible();
}

/** A finger on the strip of sheet above a panel, its way out; whatever lies there takes the tap. */
async function tapSheet(page: Page) {
  await page.touchscreen.tap(207, 40);
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

  test("draws no top bar or status bar while nothing needs them, and the tab strip makes notes", async ({
    page,
  }) => {
    await load(page);
    await expect
      .poll(async () => [
        // The top bar's New note would make two.
        await page.getByRole("button", { name: "New note" }).count(),
        await page.locator("footer").count(),
      ])
      .toEqual([1, 0]);
  });

  test("the toolbar opens the palette and the finder, the palette the search, and a tap on each sheet shuts it", async ({
    page,
  }) => {
    await load(page);
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    const palette = page.getByRole("dialog", { name: "Run a command" });
    // The way to vim's keys on a phone, which no key reaches with vim off.
    await expect(palette.getByRole("option", { name: "Toggle vim keys" })).toBeVisible();
    await tapSheet(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Find a note" }).tap();
    await expect(page.getByRole("dialog", { name: "Find note" })).toBeVisible();
    await tapSheet(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Search note content/ }).tap();
    await expect(page.getByRole("dialog", { name: "Search notes" })).toBeVisible();
    await tapSheet(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("today, todos and chat each open their own pane from the toolbar, with no dialog or drawer", async ({
    page,
  }) => {
    await load(page);
    await expect(toolbar(page).getByRole("button")).toHaveCount(6);
    // Off today's note first, or its button would have nothing to change.
    await page.getByRole("button", { name: "Find a note" }).tap();
    await page.getByRole("combobox").fill("Welcome");
    await page
      .getByRole("option", { name: /Welcome/ })
      .first()
      .tap();
    const shown = () => panes(page).locator(".cm-content").first().textContent();
    await expect.poll(shown).toContain("front door");
    const alone = async () => [
      await page.getByRole("dialog").count(),
      await page.getByRole("navigation", { name: "Vault" }).isVisible(),
    ];

    await page.getByRole("button", { name: "Open today's note" }).tap();
    await expect
      .poll(async () => [
        ...(await alone()),
        await panes(page).getByRole("heading", { name: today(), exact: true }).isVisible(),
      ])
      .toEqual([0, false, true]);
    await page.getByRole("button", { name: "Open the todo pane" }).tap();
    // The pane, not the palette's todo overlay, which is a dialog.
    await expect(page.getByRole("region", { name: "Todos" })).toBeVisible();
    expect(await alone()).toEqual([0, false]);
    await page.getByRole("button", { name: "Open the chat with Claude Code" }).tap();
    // The composer by name: the todo pane's filter is a textbox too.
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Todos" })).toHaveCount(0);
    expect(await alone()).toEqual([0, false]);
  });

  test("the next-pane button reads the pane in view, a tap moves on, and each button is 44 px", async ({
    page,
  }) => {
    await load(page);
    for (const _ of [1, 2]) {
      await page.getByRole("button", { name: "Run a command by name" }).tap();
      await page.getByRole("option", { name: /^Split the pane left and right/ }).tap();
    }
    const next = page.getByRole("button", { name: "Move to the next pane" });
    await expect(next).toHaveText(/^[123]\/3$/);
    const at = Number((await next.textContent())?.[0]);
    await next.tap();
    await expect(next).toHaveText(`${(at % 3) + 1}/3`);
    const sizes = await toolbar(page)
      .getByRole("button")
      .evaluateAll((all) => all.map((b) => b.getBoundingClientRect()))
      .then((boxes) =>
        boxes.map((box) => box.width >= 44 && Math.round(box.height * 64) / 64 >= 44),
      );
    expect(sizes).toEqual(Array(7).fill(true));
  });

  test("a tap on the toolbar leaves the focus in the editor, so the palette shut gives it back there", async ({
    page,
  }) => {
    await load(page);
    await settled(page);
    const editor = page.locator(".cm-content").first();
    await editor.tap();
    await expect(editor).toBeFocused();
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await expect(page.getByRole("dialog", { name: "Run a command" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(editor).toBeFocused();
    expect(
      await toolbar(page)
        .getByRole("button")
        .evaluateAll((all) => all.map((button) => button.getAttribute("tabindex"))),
    ).toEqual(Array(6).fill("-1"));
  });

  test("a tap inside the search shuts nothing, and the whole panel stays on the screen (#1782)", async ({
    page,
  }) => {
    await load(page);
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Search note content/ }).tap();
    const search = page.getByRole("dialog", { name: "Search notes" });
    await search.getByRole("combobox", { name: "search notes" }).tap();
    await search.getByRole("button", { name: "Filters" }).tap();
    await expect(search).toBeVisible();
    const panel = await search.locator("> div").boundingBox();
    expect(panel !== null && panel.y > 0 && panel.y + panel.height <= 896).toBe(true);
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

  test("the frame makes room for a keyboard that covers the page, the toolbar inside it", async ({
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
        await frame.getByRole("toolbar", { name: "Commands" }).count(),
      ])
      .toEqual(["300px", 1]);
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

/** Sets the browser's default font, as Chrome's Settings > Appearance > Font size does. */
async function defaultFont(page: Page, px: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setFontSizes", { fontSizes: { standard: px } });
}

/** What each `*-11` class on screen computes to, as `kind px`, the kinds a tap target sizes by (#1854). */
const elevens = (page: Page) =>
  page.evaluate(() => {
    const props: Record<string, ("minHeight" | "minWidth" | "height" | "width")[]> = {
      "min-h": ["minHeight"],
      "min-w": ["minWidth"],
      h: ["height"],
      w: ["width"],
      size: ["width", "height"],
    };
    const shown = [...document.querySelectorAll<HTMLElement>("[class*='-11']")].filter((element) =>
      element.checkVisibility(),
    );
    const seen = shown.flatMap((element) =>
      [...element.classList].flatMap((name) => {
        const kind = /^(?:pointer-coarse:)?(min-h|min-w|size|h|w)-11$/.exec(name)?.[1] ?? "";
        return (props[kind] ?? []).map((prop) => `${kind} ${getComputedStyle(element)[prop]}`);
      }),
    );
    return [...new Set(seen)].sort();
  });

test.describe("on a phone at another default font", () => {
  test.use(phone);

  /** Opens the chat and the search's filters, so a target of every kind is on screen at once. */
  async function everyKind(page: Page) {
    await load(page);
    await page.getByRole("button", { name: "Open the chat with Claude Code" }).tap();
    await expect(page.getByRole("textbox").last()).toBeVisible();
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Search note content/ }).tap();
    await page.getByRole("button", { name: "Filters" }).tap();
    await expect(page.getByRole("group", { name: "Folders" })).toBeVisible();
  }

  test("at 14 pixels every tap target of every kind still holds 44 pixels", async ({ page }) => {
    await defaultFont(page, 14);
    await everyKind(page);
    const kinds = ["h", "min-h", "min-w", "size", "w"];
    expect(await elevens(page)).toEqual(kinds.map((kind) => `${kind} 44px`));
    const search = page.getByRole("dialog", { name: "Search notes" });
    // `TAP` on a filter, and `HEADER_ROW` around the search's input.
    for (const target of [
      search.getByRole("button", { name: "Include the archive" }),
      search.getByRole("combobox", { name: "search notes" }).locator(".."),
    ])
      expect(await tapHeight(target)).toBeGreaterThanOrEqual(44);
  });

  test("at 16 pixels every tap target is 44 pixels, and at 20 it grows with the font as before", async ({
    page,
  }) => {
    await everyKind(page);
    expect(await elevens(page)).toEqual(
      ["h", "min-h", "min-w", "size", "w"].map((k) => `${k} 44px`),
    );
    await defaultFont(page, 20);
    expect(await elevens(page)).toEqual(
      ["h", "min-h", "min-w", "size", "w"].map((k) => `${k} 55px`),
    );
  });
});

test.describe("the graph pane on a phone", () => {
  test.use(phone);
  const pane = (page: Page) => page.locator("[data-graph-pane]");
  const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });

  /** Loads the app on a phone workspace holding one graph pane around `path`. */
  async function graphAround(page: Page, path: string) {
    const tabs = [{ id: "t", root: { id: "a", graph: { around: path } }, focus: "a" }];
    const stored = JSON.stringify({ layout: { tabs, active: 0 }, treeOpen: false });
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [COARSE, stored]);
    await page.goto("/");
    await expect(pane(page).locator("canvas")).toBeVisible({ timeout: 15_000 });
  }

  /** Taps the middle of the canvas, where a graph of one note fits it once settled. */
  async function tapMiddle(page: Page) {
    await expect(pane(page).getByLabel("zoom")).toBeVisible();
    const box = await page.getByTestId("graph-canvas").boundingBox();
    if (!box) throw new Error("no canvas");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }

  test("Space presses the fit, depth, Create and Cancel buttons and starts no leader sequence", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "Lone.md": "links to [[Nowhere]]\n" });
    // The answer holds the missing note alone, so it sits where a tap can find it.
    const ghost = { path: "Nowhere.md", name: "Nowhere", type: null, tags: [], missing: true };
    const json = { nodes: [ghost], edges: [], columns: [], rows: [], truncated: false };
    await page.route("**/api/graph?*", (route) => route.fulfill({ json }));
    await graphAround(page, "Lone.md");
    const asked = pane(page).getByText("Create Nowhere?");
    const button = (name: string) => pane(page).getByRole("button", { name, exact: true });

    /** Space on the button, then `b`, which a leader sequence would take as the tree's toggle. */
    async function space(name: string) {
      await button(name).focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("b");
      await expect(tree(page)).toBeHidden();
    }

    await tapMiddle(page);
    await expect(asked).toBeVisible();
    await space("Cancel");
    await expect(asked).toBeHidden();
    await space("one link further");
    await expect(pane(page).getByText("depth 2")).toBeVisible();
    await space("one link nearer");
    await expect(pane(page).getByText("depth 1")).toBeVisible();
    await space("fit");

    await tapMiddle(page);
    await expect(asked).toBeVisible();
    await space("Create");
    await expect(pane(page)).toHaveCount(0);
  });

  test("a note's Graph button opens the Local graph sheet, and a tap on a row there opens that note", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "Lone.md": "links to [[Welcome]]\n" });
    const tabs = [{ id: "t", root: { id: "a", path: "Lone.md" }, focus: "a" }];
    const stored = JSON.stringify({ layout: { tabs, active: 0 }, treeOpen: false });
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [COARSE, stored]);
    await load(page);

    await page.locator("[data-head='graph']").tap();
    const sheet = page.getByRole("dialog", { name: "Local graph" });
    await sheet.getByRole("button", { name: "Welcome", exact: true }).tap();

    await expect(sheet).toBeHidden();
    await expect(page.locator(".cm-content")).toContainText(
      "The front door of the e2e fixture vault",
    );
  });

  test("a tap on a row button opens its note", async ({ page, stack }) => {
    await vaultWith(stack.vault, { "Lone.md": "links to [[Welcome]]\n" });
    await graphAround(page, "Lone.md");
    await pane(page).getByLabel("graph query").fill("?a links [[Welcome]]");
    await page.keyboard.press("Enter");
    await pane(page).getByRole("button", { name: "Lone", exact: true }).tap();
    await expect(pane(page)).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("links to");
  });
});
