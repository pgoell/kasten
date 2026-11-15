import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import { builtCss, leader, openApp, openNote, PANE, panes, readAll } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";
import { beside, focusedPane, layout, load, seed } from "./workspace/stored.ts";

/** The saved layout of each tab: split direction, zoom, pane count and focused pane, and the active tab. */
const saved = (page: Page) =>
  page.evaluate(() => {
    type Node = { id: string; dir?: string; children?: Node[] };
    const all = (node: Node): Node[] => node.children?.flatMap(all) ?? [node];
    const { layout } = JSON.parse(localStorage.getItem("kasten.workspace.1") ?? "null");
    return {
      active: layout.active as number,
      tabs: (layout.tabs as { root: Node; focus: string; zoom?: boolean }[]).map((tab) => ({
        dir: tab.root.dir ?? null,
        zoom: tab.zoom ?? false,
        leaves: all(tab.root).length,
        focus: all(tab.root).findIndex((leaf) => leaf.id === tab.focus),
      })),
    };
  });

const selected = (page: Page) =>
  readAll(page, '[role="tab"]', (tabs) => tabs.map((tab) => tab.getAttribute("aria-selected")));

/** Opens the palette and runs the row with this name, as vim off reaches every pane command. */
async function runRow(page: Page, name: RegExp) {
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name }).click();
}

test.describe("the pane and tab keys", () => {
  test('Space " splits the pane top and bottom, and the new pane below holds the focus', async ({
    page,
  }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, '"');
    const lower = async () => {
      const [upper, under] = await Promise.all(
        (await panes(page).all()).map((pane) => pane.boundingBox()),
      );
      const focus = await page.locator(".cm-content:focus").boundingBox();
      return !!upper && !!under && !!focus && under.y > upper.y && focus.y >= under.y;
    };
    await expect
      .poll(async () => [await panes(page).count(), await lower(), await saved(page)])
      .toEqual([2, true, { active: 0, tabs: [{ dir: "col", zoom: false, leaves: 2, focus: 1 }] }]);
  });

  test("Space z draws the pane alone and says zoom in the bar, and a second press puts the tab back", async ({
    page,
  }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "%");
    await expect(panes(page)).toHaveCount(2);
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    // The focused pane counts among the panes on screen, so the hidden one leaves it first.
    const state = async () => [
      await panes(page).count(),
      (await saved(page)).tabs[0].zoom,
      await focusedPane(page),
      await page.getByTestId("zoom-shown").isVisible(),
    ];
    expect(await page.getByTestId("zoom-shown").isVisible()).toBe(false);
    await leader(page, "z");
    await expect.poll(state).toEqual([1, true, 0, true]);
    await expect(page.getByTestId("zoom-shown")).toHaveText("zoom");
    await leader(page, "z");
    await expect.poll(state).toEqual([2, false, 1, false]);
  });

  test("Space q on a split closes the note, then the pane, and keeps the tab", async ({ page }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "%");
    await openNote(page, "Long note");
    const state = async () => [
      await panes(page).count(),
      await page.locator(".cm-content", { hasText: "long enough" }).count(),
      await saved(page),
    ];
    await leader(page, "q");
    await expect
      .poll(state)
      .toEqual([2, 0, { active: 0, tabs: [{ dir: "row", zoom: false, leaves: 2, focus: 1 }] }]);
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    await leader(page, "q");
    await expect
      .poll(state)
      .toEqual([1, 0, { active: 0, tabs: [{ dir: null, zoom: false, leaves: 1, focus: 0 }] }]);
    await expect(page.locator(".cm-content", { hasText: "front door" })).toBeVisible();
  });

  test("Space 1 and Space 2 go to the first and second tab", async ({ page }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "ct");
    await expect.poll(() => selected(page)).toEqual(["false", "true"]);
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    await leader(page, "1");
    await expect
      .poll(async () => [await selected(page), (await saved(page)).active])
      .toEqual([["true", "false"], 0]);
    await expect(page.locator(".cm-content:focus", { hasText: "front door" })).toHaveCount(1);
    await leader(page, "2");
    await expect
      .poll(async () => [await selected(page), (await saved(page)).active])
      .toEqual([["false", "true"], 1]);
  });

  test.describe("with vim off", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    });

    test("the palette row Split the pane left and right splits the pane", async ({ page }) => {
      await openApp(page);
      await openNote(page, "Welcome");
      await expect(page.locator(".cm-vimMode")).toHaveCount(0);
      await runRow(page, /^Split the pane left and right/);
      await expect
        .poll(async () => [await panes(page).count(), await saved(page)])
        .toEqual([2, { active: 0, tabs: [{ dir: "row", zoom: false, leaves: 2, focus: 1 }] }]);
    });

    test("the palette rows Go to tab 1 and Go to tab 2 go to the first and second tab", async ({
      page,
    }) => {
      await openApp(page);
      await openNote(page, "Welcome");
      await runRow(page, /^Create a tab/);
      await expect.poll(() => selected(page)).toEqual(["false", "true"]);
      await runRow(page, /^Go to tab 1(?!\d)/);
      await expect
        .poll(async () => [await selected(page), (await saved(page)).active])
        .toEqual([["true", "false"], 0]);
      await runRow(page, /^Go to tab 2(?!\d)/);
      await expect
        .poll(async () => [await selected(page), (await saved(page)).active])
        .toEqual([["false", "true"], 1]);
    });
  });
});

const GLASS = "blur(18px) saturate(1.4)";

/** The backdrop filter Chromium draws for the strip's row, which holds Today beside the tablist. */
const stripBlur = (page: Page) =>
  page
    .getByRole("tablist")
    .first()
    .evaluate((list) => getComputedStyle(list.parentElement as HTMLElement).backdropFilter);

test("the tab strip is glass that stays at the top, with one hairline", async ({ page }) => {
  await openApp(page);
  const strip = await page
    .getByRole("tablist")
    .first()
    .evaluate((list) => {
      const style = getComputedStyle(list.parentElement as HTMLElement);
      return [style.position, style.backgroundColor, style.borderBottom, style.borderTopWidth];
    });
  expect(strip[0]).toBe("sticky");
  expect(strip[1]).toMatch(/ \/ 0\.84\)$/);
  expect(strip[2]).toMatch(/^1px solid /);
  expect(strip[3]).toBe("0px");
  // Lightning CSS dropped this line when the source wrote the -webkit- twin after it (#1986).
  expect(await stripBlur(page)).toBe(GLASS);
});

test("the built css gives Safari the tab strip's prefixed blur ahead of the one Chromium reads", async ({
  page,
}) => {
  await openApp(page);
  const css = await builtCss(page);
  const glass =
    /\.k-glass\{-webkit-backdrop-filter:blur\(18px\) ?saturate\(1\.4\);backdrop-filter:blur\(18px\) ?saturate\(1\.4\)\}/;
  expect(css).toMatch(glass);
  // The reduced transparency and more contrast rules each turn both off.
  expect(
    css.match(/\.k-glass\{[^}]*-webkit-backdrop-filter:none;backdrop-filter:none\}/g),
  ).toHaveLength(2);
});

test("more contrast takes the tab strip's blur away, and back when it ends", async ({ page }) => {
  await openApp(page);
  await page.emulateMedia({ contrast: "more" });
  await expect.poll(() => stripBlur(page)).toBe("none");
  await page.emulateMedia({ contrast: "no-preference" });
  await expect.poll(() => stripBlur(page)).toBe(GLASS);
});

test("reduced transparency takes the tab strip's blur away", async ({ page }) => {
  await openApp(page);
  await expect.poll(() => stripBlur(page)).toBe(GLASS);
  // Playwright's emulateMedia has no reduced transparency; Chromium's own emulation does.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });
  await expect.poll(() => stripBlur(page)).toBe("none");
});

test.describe("the pane header", () => {
  const headers = (page: Page) => page.locator(`${PANE}:visible [data-pane-header]`);
  /** Each pane's focus line as its height and colour, and its frame (box and header) as tags and classes. */
  const frames = (page: Page) =>
    readAll(page, PANE, (all) =>
      all.map((pane) => {
        const line = getComputedStyle(pane.querySelector("[data-focus-line]") as Element);
        const header = pane.querySelector("[data-pane-header]") as Element;
        const frame = [pane, header, ...header.querySelectorAll("*")];
        return {
          line: `${line.height} ${line.backgroundColor}`,
          frame: frame.map((node) => `${node.tagName} ${node.getAttribute("class")}`).join("|"),
        };
      }),
    );

  test("a split draws a header per pane with its kind and path, and a single or zoomed pane none", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    await expect(headers(page)).toHaveCount(0);
    await seed(
      page,
      layout([beside({ path: "Welcome.md" }, { pdf: { path: "04 Books/Primer.pdf" } })]),
    );
    await page.reload();
    await expect(headers(page)).toHaveCount(2);
    await expect(headers(page).nth(0)).toContainText("Welcome.md");
    await expect(headers(page).nth(1)).toContainText("PDF");
    await expect(headers(page).nth(1)).toContainText("04 Books/Primer.pdf");
    await panes(page).nth(0).locator(".cm-line").first().click();
    await page.keyboard.press("Escape");
    await leader(page, "z");
    await expect(panes(page)).toHaveCount(1);
    await expect(page.locator("[data-pane-header], [data-focus-line]")).toHaveCount(0);
    await leader(page, "z");
    await expect(headers(page)).toHaveCount(2);
  });

  test("the focused pane carries the 2 px accent line, and moving the focus moves the line alone", async ({
    page,
  }) => {
    await seed(page, layout([beside({ path: "Welcome.md" }, { path: "02 Projects/Home.md" })]));
    await load(page);
    await panes(page).nth(0).locator(".cm-line").first().click();
    await page.keyboard.press("Escape");
    const clear = "rgba(0, 0, 0, 0)";
    await expect
      .poll(async () => (await frames(page)).map(({ line }) => line.endsWith(clear)))
      .toEqual([false, true]);
    const before = await frames(page);
    expect(before.map(({ line }) => line.split(" ")[0])).toEqual(["2px", "2px"]);
    // Both frames read the same, focused or not: only the line tells them apart.
    expect(before[0]?.frame).toBe(before[1]?.frame);
    await leader(page, "l");
    await expect
      .poll(async () => (await frames(page)).map(({ line }) => line))
      .toEqual([before[1]?.line, before[0]?.line]);
    expect((await frames(page)).map(({ frame }) => frame)).toEqual(
      before.map(({ frame }) => frame),
    );
  });
});

test.describe("the terminal prompt", () => {
  const prompt = (page: Page) => page.getByRole("dialog", { name: "Open terminal" });
  const field = (page: Page) => prompt(page).getByRole("combobox");
  const rule = (page: Page) => prompt(page).locator("output");
  const picked = (page: Page) => prompt(page).locator('[role="option"][aria-selected="true"]');

  /** Makes each herdr session the backend lists, opens the app and `Space c s`; answers the sessions opened. */
  async function ask(page: Page, vault: string, sessions: string[] = []) {
    for (const name of sessions)
      await mkdir(join(dirname(vault), "herdr", name), { recursive: true });
    const opened: string[] = [];
    page.on("websocket", (socket) => {
      const arg = new URL(socket.url()).searchParams.get("arg");
      if (arg !== null) opened.push(arg);
    });
    await openApp(page);
    await leader(page, "cs");
    await expect(field(page)).toBeFocused();
    return opened;
  }
  const SESSIONS = ["agent-kasten", "notes", "scratch"];

  test("refuses an empty name and one with a space, saying the rule, and Escape opens nothing", async ({
    page,
    stack,
  }) => {
    const opened = await ask(page, stack.vault);
    await page.keyboard.press("Enter");
    await expect(rule(page)).toContainText("letters, numbers");
    await page.keyboard.type("my session");
    await page.keyboard.press("Enter");
    await expect(rule(page)).toContainText("letters, numbers");
    await expect(prompt(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(prompt(page)).toHaveCount(0);
    await expect(page.locator(".xterm")).toHaveCount(0);
    expect(opened).toEqual([]);
  });

  test("offers the sessions that exist, narrows them as you type, and Tab then Enter opens the one taken", async ({
    page,
    stack,
  }) => {
    const opened = await ask(page, stack.vault, SESSIONS);
    await expect(prompt(page).getByRole("option")).toHaveText(SESSIONS);
    await page.keyboard.type("not");
    await expect(prompt(page).getByRole("option")).toHaveText(["notes"]);
    await field(page).fill("scr");
    await page.keyboard.press("Tab");
    await expect(field(page)).toHaveValue("scratch");
    await expect(field(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm").first()).toBeVisible();
    expect(opened).toEqual(["scratch"]);
  });

  test("a click on a session's row opens it", async ({ page, stack }) => {
    const opened = await ask(page, stack.vault, SESSIONS);
    await prompt(page).getByRole("option", { name: "notes" }).click();
    await expect(page.locator(".xterm").first()).toBeVisible();
    expect(opened).toEqual(["notes"]);
  });

  test("with no sessions it draws no list, and a new name still opens, starting one", async ({
    page,
    stack,
  }) => {
    const opened = await ask(page, stack.vault);
    await page.keyboard.type("brand-new");
    await expect(prompt(page).getByRole("listbox")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm").first()).toBeVisible();
    expect(opened).toEqual(["brand-new"]);
  });

  test("the arrows and ctrl+n and ctrl+p move the highlight and stop at either end, Tab takes it, and with no match an arrow moves the caret", async ({
    page,
    stack,
  }) => {
    await ask(page, stack.vault, SESSIONS);
    await page.keyboard.type("s");
    const rows = await prompt(page).getByRole("option").allTextContents();
    expect(rows.length).toBeGreaterThan(2);
    await expect(picked(page)).toHaveText(rows[0]);
    await page.keyboard.press("ArrowDown");
    await expect(picked(page)).toHaveText(rows[1]);
    for (const _ of rows) await page.keyboard.press("Control+n");
    await expect(picked(page)).toHaveText(rows[rows.length - 1]);
    for (const _ of rows) await page.keyboard.press("ArrowUp");
    await expect(picked(page)).toHaveText(rows[0]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Control+p");
    await expect(picked(page)).toHaveText(rows[0]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await expect(field(page)).toHaveValue(rows[1]);

    await field(page).fill("zzz");
    await expect(prompt(page).getByRole("option")).toHaveCount(0);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    expect(await field(page).evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(3);
    await expect(prompt(page)).toBeVisible();
  });

  test("with vim off its palette row opens it, as wide as the New note prompt", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await openApp(page);
    const width = (name: string) =>
      page
        .getByRole("dialog", { name })
        .locator(":scope > div")
        .first()
        .evaluate((panel) => panel.getBoundingClientRect().width);
    await page.getByRole("button", { name: "New note", exact: true }).first().click();
    const note = await width("New note");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New note" })).toHaveCount(0);
    await runRow(page, /^Open a terminal/);
    await expect(field(page)).toBeFocused();
    expect(await width("Open terminal")).toBe(note);
  });
});

test.describe("the palette chord after the New note prompt closes", () => {
  const prompt = (page: Page) => page.getByRole("dialog", { name: "New note" });
  for (const vim of ["on", "off"])
    for (const via of ["button", "leader"].slice(0, vim === "on" ? 2 : 1))
      for (const close of ["Escape", "backdrop"])
        test(`vim ${vim}, opened by ${via}, closed by ${close}: Ctrl+Shift+P opens the palette`, async ({
          page,
        }) => {
          await page.addInitScript((v) => localStorage.setItem("kasten.vim", v), vim);
          await openApp(page);
          if (via === "leader") await leader(page, "cf");
          else await page.getByRole("button", { name: "New note", exact: true }).first().click();
          await expect(prompt(page).getByRole("combobox")).toBeFocused();
          if (close === "Escape") await page.keyboard.press("Escape");
          else await prompt(page).click({ position: { x: 5, y: 5 } });
          await expect(prompt(page)).toHaveCount(0);
          await page.keyboard.press("Control+Shift+P");
          await expect(page.getByRole("dialog", { name: "Run a command" })).toBeVisible();
        });
});
