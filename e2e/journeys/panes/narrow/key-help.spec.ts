import type { Locator, Page } from "@playwright/test";
import { bodyOf, findNote, leader, noteText, openApp, panes, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { beside, layout, load, seed, selectedTab } from "../workspace/stored.ts";

/** The left edge and top of each box, rounded to the pixel. */
const corners = (all: Locator): Promise<[number, number][]> =>
  all.evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return [Math.round(box.x), Math.round(box.y)] as [number, number];
    }),
  );

test("the which-key panel sets its groups side by side, and an open group flows its rows into columns", async ({
  page,
}) => {
  await openApp(page);
  await page.keyboard.press("Space");
  const panel = page.getByRole("dialog", { name: "Leader keys" });
  await expect(panel.getByRole("heading", { name: "Find" })).toBeVisible();
  const groups = await corners(panel.locator("section:has(> h3)"));
  const firstRow = groups.filter(([, y]) => y === groups[0]?.[1]);
  expect(firstRow.length).toBeGreaterThan(1);

  await page.keyboard.press("g");
  await expect(panel.getByRole("heading", { name: "Go to" })).toBeVisible();
  const rows = await corners(panel.locator("section:has(> h3) button"));
  expect(new Set(rows.map(([x]) => x)).size).toBeGreaterThan(1);
});

test("opened from the palette with vim on, Esc gives the focus back to the note's editor", async ({
  page,
}) => {
  await openApp(page);
  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeFocused();
  await leader(page, ":");
  await page.getByRole("combobox").fill("Show the keys");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("searchbox", { name: "Filter keys" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toBeFocused();
});

test("opened from the palette with vim off, Esc gives the focus back to the note's editor", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await openApp(page);
  const editor = page.locator(".cm-content").first();
  await editor.locator(".cm-line:visible").last().click();
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("combobox").fill("Show the keys");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("searchbox", { name: "Filter keys" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toBeFocused();
});

test.describe("the key help on a phone", () => {
  test.use(phone);

  test("opens from the palette as a sheet the whole screen tall with a grabber, the filter focused and one column", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: "Show the keys" }).tap();
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    // The grabber, not the header: a drag on either moves the sheet.
    await expect(help.locator("[data-sheet-drag]:not(:has(input))")).toBeVisible();
    await expect(help.getByRole("searchbox", { name: "Filter keys" })).toBeFocused();
    // Once the rise ends: the top of the screen, past the 88% a capped sheet stops at.
    await expect
      .poll(async () => {
        const box = await help.boundingBox();
        return box !== null && box.y < 1 && box.height > 890;
      })
      .toBe(true);
    const [space, rest] = await corners(
      help.getByRole("heading", { name: /^(After Space|Vim and the rest)$/, level: 2 }),
    );
    expect(
      space !== undefined && rest !== undefined && space[0] === rest[0] && rest[1] > space[1],
    ).toBe(true);
    await expect(help.getByText("Drag down or tap outside to close")).toBeInViewport();
  });

  test("opened from the palette, Esc takes the sheet down and gives the focus back to the tab that held it", async ({
    page,
  }) => {
    await page.goto("/");
    const tab = page.getByRole("tab", { selected: true });
    await tab.tap();
    await expect(tab).toBeFocused();
    await page.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: "Show the keys" }).tap();
    await expect(page.getByRole("searchbox", { name: "Filter keys" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tab).toBeFocused();
  });

  // A phone with a keyboard: the sheet takes the focus for its panel before the help's effect runs.
  test("opened by ?, Esc gives the focus back to the tab that held it", async ({ page }) => {
    await page.goto("/");
    const tab = page.getByRole("tab", { selected: true });
    await tab.tap();
    await expect(tab).toBeFocused();
    await page.keyboard.press("?");
    await expect(page.getByRole("searchbox", { name: "Filter keys" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tab).toBeFocused();
  });
});

test.describe("the palette chord (#2068)", () => {
  const palette = (page: Page) => page.getByRole("dialog", { name: "Run a command" });
  /** Opens a palette row by name, through the palette, and closes nothing. */
  async function run(page: Page, row: string) {
    await page.keyboard.press("Control+Shift+P");
    await palette(page)
      .getByRole("option", { name: new RegExp(`^${row}`) })
      .click();
    await expect(palette(page)).toHaveCount(0);
  }
  const HOMES: [string, (page: Page) => Promise<void>][] = [
    ["a tree row", (page) => page.getByRole("button", { name: "Welcome", exact: true }).focus()],
    ["a tab", (page) => page.getByRole("tab", { selected: true }).first().focus()],
    ["the todo pane", (page) => run(page, "Open the todo pane")],
    [
      "the chat box",
      async (page) => {
        await run(page, "Open the chat with Claude Code");
        await page.getByRole("textbox").last().focus();
      },
    ],
  ];
  for (const vim of ["on", "off"])
    for (const [home, go] of HOMES)
      test(`vim ${vim}, with the focus on ${home}, opens the palette`, async ({ page }) => {
        await page.addInitScript((v) => localStorage.setItem("kasten.vim", v), vim);
        await openApp(page);
        await go(page);
        await expect(page.locator(".cm-editor:focus-within")).toHaveCount(0);
        await page.keyboard.press("Control+Shift+P");
        await expect(palette(page)).toHaveCount(1);
      });

  test("inside the open New note prompt or palette it opens no palette over it", async ({
    page,
  }) => {
    await openApp(page);
    await leader(page, "cf");
    const prompt = page.getByRole("dialog", { name: "New note" });
    await expect(prompt.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Control+Shift+P");
    await expect(prompt).toBeVisible();
    await expect(palette(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.press("Control+Shift+P");
    await expect(palette(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test.describe("on a phone", () => {
    test.use(phone);
    test("after the New note prompt closes by a tap outside, run opens the palette", async ({
      page,
    }) => {
      await page.goto("/");
      const runButton = page.getByRole("button", { name: "Run a command by name" });
      await runButton.tap();
      await palette(page)
        .getByRole("option", { name: /^Create a note/ })
        .tap();
      const prompt = page.getByRole("dialog", { name: "New note" });
      await expect(prompt).toBeVisible();
      await prompt.tap({ position: { x: 5, y: 5 } });
      await expect(prompt).toHaveCount(0);
      await runButton.tap();
      await expect(palette(page)).toBeVisible();
    });
  });
});

test.describe("the which-key panel", () => {
  const panel = (page: Page) => page.getByRole("dialog", { name: "Leader keys" });
  const rowOf = (page: Page, name: string | RegExp) => panel(page).getByRole("button", { name });
  const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });
  const focusIn = (page: Page) => expect(page.locator(".cm-content:focus")).toHaveCount(1);
  /** A note of one line, open with the editor focused in normal mode. */
  async function lineNote(page: Page, vault: string) {
    await vaultWith(vault, { "Line.md": "abc\n" });
    await openApp(page);
    await findNote(page, "Line");
  }
  const line = (vault: string) => noteText(vault, "Line.md").then(bodyOf);

  test("from the tree it shows the six columns and none of the editor's edits, and x closes it and runs nothing", async ({
    page,
  }) => {
    await openApp(page);
    await leader(page, "e");
    await expect(tree(page).locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Space");
    await expect(panel(page).getByRole("heading", { level: 3 })).toHaveText(["Find", "Create", "Go to", "Tabs", "Panes", "This note"]);
    await expect(panel(page).getByText("Tidy the markdown in this note")).toHaveCount(0);
    await expect(panel(page).getByText("Set the todo's state …")).toHaveCount(0);
    await page.keyboard.press("x");
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tree(page).locator(":focus")).toHaveCount(1);
    expect([await panes(page).count(), await page.getByRole("tab").count()]).toEqual([1, 1]);
  });

  test("from a note each group is one row and opens on a click, g narrows, Backspace and the Space chip go back, and ct sits under Tabs", async ({
    page,
  }) => {
    await openApp(page);
    await findNote(page, "Welcome");
    await page.keyboard.press("Space");
    for (const name of ["Toggle the file tree", "Tidy the markdown in this note", "Show the keys"])
      await expect(rowOf(page, new RegExp(name))).toHaveCount(1);
    for (const group of ["Find", "Create", "Delete or undo", "Go to", "Rename or read", "Set the todo's state", "Tabs"])
      await expect(panel(page).getByText(`${group} …`, { exact: true })).toHaveCount(1);
    await expect(rowOf(page, /Open today's note/)).toHaveCount(0);
    const digits = panel(page).locator("section", { has: page.locator("kbd", { hasText: "1 … 0" }) });
    await expect(digits.getByRole("heading")).toHaveText("Tabs");
    await expect(panel(page).locator("button kbd", { hasText: "1 … 0" })).toHaveCount(0);
    await rowOf(page, /Go to …/).click();
    await expect(rowOf(page, /Open today's note/)).toBeVisible();
    await expect(panel(page).getByRole("heading", { name: "Find" })).toHaveCount(0);
    await page.keyboard.press("Backspace");
    await expect(panel(page).getByText("Go to …")).toBeVisible();
    await page.keyboard.press("c");
    const tabs = panel(page).locator("section", { has: page.getByRole("heading", { name: "Tabs" }) });
    await expect(tabs.getByRole("button", { name: /Create a tab/ })).toBeVisible();
    await panel(page).getByRole("button", { name: "Back to the groups" }).click();
    await expect(panel(page).getByText("Create …")).toBeVisible();
    await expect(rowOf(page, /Create a tab/)).toHaveCount(0);
  });

  test("Tab stays inside the panel, and a click on a row runs it and closes", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Space");
    const buttons = panel(page).getByRole("button");
    await buttons.last().focus();
    await page.keyboard.press("Tab");
    await expect(buttons.first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(buttons.last()).toBeFocused();
    await rowOf(page, /Toggle the file tree/).click();
    await expect(tree(page)).toBeHidden();
    await expect(panel(page)).toHaveCount(0);
  });

  test("Esc and Space close it with the focus back, and y reaches nothing behind it", async ({
    page,
    stack,
  }) => {
    await lineNote(page, stack.vault);
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await focusIn(page);
    await leader(page, " ");
    await expect(panel(page)).toHaveCount(0);
    // A y that got through would make yy, and the p would paste the line.
    for (const key of [" ", "y", "y", "p", "0", "x"]) await page.keyboard.press(key);
    await expect.poll(() => line(stack.vault), { timeout: 15_000 }).toBe("bc\n");
  });

  test("a press outside closes it and the next key goes where the press put the focus", async ({ page, stack }) => {
    await vaultWith(stack.vault, { "Line.md": "abc\n" });
    await seed(page, layout([beside({ path: "Welcome.md" }, { path: "Line.md" })]));
    await load(page);
    await panes(page).nth(0).locator(".cm-line").first().click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Space");
    await expect(panel(page)).toBeVisible();
    await panes(page).nth(1).locator(".cm-line", { hasText: "abc" }).click({ position: { x: 1, y: 5 } });
    await page.keyboard.press("x");
    await expect.poll(() => line(stack.vault), { timeout: 15_000 }).toBe("bc\n");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a key held with Ctrl, Alt or Meta closes it, runs nothing and gives the focus back", async ({ page }) => {
    const tab = (path: string, i: number) => ({ id: `t${i}`, root: { id: `p${i}`, path }, focus: `p${i}` });
    await seed(page, layout(["Welcome.md", "01 Notes/Quote.md", "01 Notes/Seeds.md"].map(tab)));
    await load(page);
    await panes(page).locator(".cm-line").first().click();
    await page.keyboard.press("Escape");
    // 3 alone goes to the third tab and % splits, so only the held key keeps each from running.
    for (const chord of ["Control+3", "Alt+3", "Meta+3", "Control+Alt+3", "Meta+%"]) {
      await page.keyboard.press("Space");
      await expect(panel(page)).toBeVisible();
      await page.keyboard.press(chord);
      await expect(panel(page)).toHaveCount(0);
      await focusIn(page);
      expect([await selectedTab(page), await panes(page).count()]).toEqual(["Welcome", 1]);
    }
  });

  test("keys sent in the same task as Space still go to the panel, and the finder keeps the focus ff gave it", async ({
    page,
  }) => {
    await openApp(page);
    await focusIn(page);
    await page.locator(".cm-content").evaluate((el) => {
      for (const key of [" ", "f", "f"])
        el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
    const finder = page.getByRole("dialog", { name: "Find note" }).getByRole("combobox");
    await expect(finder).toBeFocused();
    await expect(finder).toHaveValue("");
    await expect(panel(page)).toHaveCount(0);
  });

  test("in the finance pane the note's keys are left out, and a line says so", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the finance pane/ }).click();
    await page.getByRole("region", { name: "Finance" }).focus();
    await page.keyboard.press("Space");
    await expect(rowOf(page, /Toggle the file tree/)).toBeVisible();
    await expect(panel(page).getByText(/left out/)).toBeVisible();
    await expect(rowOf(page, /Toggle live preview/)).toHaveCount(0);
    await expect(panel(page).getByText("Rename or read …")).toHaveCount(0);
  });
});
