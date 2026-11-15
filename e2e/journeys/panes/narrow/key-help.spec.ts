import type { Locator, Page } from "@playwright/test";
import { findNote, leader, noteText, openApp, phone, TODO_ROW, unstamped, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

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

/** CDP's modifier bits. */
const ALT = 1;
const CTRL = 2;
/** A German layout's key for each character: AltGr's on Windows and Linux, then Option's on a Mac. */
const GERMAN = {
  "@": ["KeyQ", "KeyL"],
  "~": ["BracketRight", "KeyN"],
  "{": ["Digit7", "Digit8"],
  "}": ["Digit0", "Digit9"],
  "[": ["Digit8", "Digit5"],
  "]": ["Digit9", "Digit6"],
  "|": ["IntlBackslash", "Digit7"],
  "€": ["KeyE", "KeyE"],
} as const;
type Layout = "windows" | "linux" | "mac";

/**
 * How a character arrives from a German layout: AltGr reads as Ctrl+Alt on Windows and as an `AltGraph`
 * press with no flag on Linux; a German Mac's Option is Alt. Each sends its modifier's own press first.
 */
function presses(layout: Layout, char: keyof typeof GERMAN): [string, string, number][] {
  const [altGr, option] = GERMAN[char];
  if (layout === "windows")
    return [["Control", "ControlLeft", CTRL], ["AltGraph", "AltRight", CTRL | ALT], [char, altGr, CTRL | ALT]];
  if (layout === "linux") return [["AltGraph", "AltRight", 0], [char, altGr, 0]];
  return [["Alt", "AltLeft", ALT], [char, option, ALT]];
}

async function typeAt(page: Page, layout: Layout, char: keyof typeof GERMAN = "@", upTo = 3) {
  await send(page, presses(layout, char).slice(0, upTo), char);
}

/** Holds each press down in turn, the last with `typed` as its text, then lets them go. */
async function send(page: Page, sent: [string, string, number][], typed?: string) {
  const cdp = await page.context().newCDPSession(page);
  for (const [key, code, modifiers] of sent) {
    const text = key === typed ? { text: key } : {};
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, ...text });
  }
  for (const [key, code, modifiers] of sent.toReversed())
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await cdp.detach();
}

test.describe("@ typed through AltGr or Option (#2071)", () => {
  const NOTE = "01 Notes/Bank.md";
  for (const layout of ["windows", "linux", "mac"] as const)
    test(`vim on, Space @ on a ${layout} layout sends the todo to the agent, and u takes it back`, async ({
      page,
      stack,
    }) => {
      await vaultWith(stack.vault, { [NOTE]: "# Bank\n\n- [ ] ring the bank" });
      await openApp(page);
      await findNote(page, "Bank");
      await page.keyboard.press("G");
      await page.keyboard.press("Space");
      await expect(page.getByRole("dialog", { name: "Leader keys" })).toBeVisible();
      await typeAt(page, layout);
      await expect.poll(() => noteText(stack.vault, NOTE)).toContain("- [ ] ring the bank #agent");
      await page.keyboard.press("u");
      await expect.poll(() => noteText(stack.vault, NOTE)).not.toContain("#agent");
    });

  test("vim off, @ typed through AltGr or Option in a note types @ and nothing else", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await vaultWith(stack.vault, { "Mail.md": "# Mail\n\nmail " });
    await openApp(page);
    await page.getByRole("button", { name: "Mail", exact: true }).click();
    await page.locator(".cm-line", { hasText: /^mail/ }).click();
    await page.keyboard.press("End");
    // Chromium on Linux types no text held with Ctrl, as a plain textarea shows, so the windows shape is left out here.
    let typed = "mail ";
    for (const layout of ["linux", "mac"] as const) {
      await typeAt(page, layout);
      typed += "@";
      await expect(page.locator(".cm-content")).toContainText(typed);
    }
    await expect.poll(() => noteText(stack.vault, "Mail.md")).toContain(typed);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("vim off, in the todo pane AltGr's own press keeps the panel open, and @ on a linux layout tags the row", async ({
    page,
    stack,
  }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await openApp(page);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the todo pane/ }).click();
    const cursor = page.locator(`${TODO_ROW}[tabindex="0"]`);
    await cursor.focus();
    for (const layout of ["windows", "linux", "mac"] as const) {
      await page.keyboard.press("Space");
      const panel = page.getByRole("dialog", { name: "Leader keys" });
      await expect(panel).toBeVisible();
      await typeAt(page, layout, "@", layout === "windows" ? 2 : 1);
      await expect(panel).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
    }
    const row = (await cursor.getAttribute("data-row")) ?? "";
    const path = row.slice(0, row.lastIndexOf(":"));
    const at = Number(row.slice(row.lastIndexOf(":") + 1)) - 1;
    const words = (await noteText(stack.vault, path)).split("\n")[at]?.replace(/^- \[ \] /, "") ?? "";
    await typeAt(page, "linux");
    // The write adds the note's own frontmatter, so the line is found by its words, not its number.
    await expect
      .poll(async () => (await noteText(stack.vault, path)).includes(`${words} #agent`))
      .toBe(true);
  });
});

/** Records each keydown of a character typed with AltGr or Option, so a journey can read who took it. */
async function watchTyped(page: Page) {
  await page.addInitScript(() => {
    const typed: KeyboardEvent[] = [];
    Object.assign(window, { typed });
    window.addEventListener("keydown", (e) => e.key.length === 1 && "@~{}[]|€".includes(e.key) && typed.push(e), true);
  });
}
/** The cursor's line and column, off CodeMirror's own view, which the bundle reaches only through its DOM. */
const cursor = (page: Page) =>
  page.locator(".cm-content:visible").evaluate((el) => {
    type State = { selection: { main: { head: number } }; doc: { lineAt(at: number): { text: string; from: number } } };
    const { state } = (el as unknown as { cmTile: { root: { view: { state: State } } } }).cmTile.root.view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    return `${line.text}@${head - line.from}`;
  });
const taken = (page: Page) =>
  page.evaluate(() => (window as unknown as { typed: KeyboardEvent[] }).typed.map((e) => e.defaultPrevented));

test.describe("vim's own keys typed through AltGr or Option (#2073)", () => {
  const NOTE = "Keys.md";
  // Stamped as a save stamps it, so no save adds lines above the cursor mid-journey.
  const STAMPS = "---\nid: 01a1df77-0000-7000-8000-000000002073\ncreated: 2026-11-15T13:00:00+00:00\ntype: Note\n";
  const HEAD = `${STAMPS}modified: 2026-11-15T13:00:00+00:00\n---\n# Keys\n\n`;
  const BODY = `${HEAD}{ alpha\nbravo\n\ncharlie\n{ delta\necho foxtrot`;
  test.beforeEach(async ({ page }) => {
    await watchTyped(page);
    // CodeMirror reads a Mac from the platform once, and its vim then drops a lone Alt for a typed character.
    if (test.info().title.includes("mac"))
      await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" }));
  });

  for (const layout of ["windows", "linux", "mac"] as const)
    test(`on a ${layout} layout | [[ ]] { } r| ~ and @q act in normal mode and type nothing`, async ({ page, stack }) => {
      await vaultWith(stack.vault, { [NOTE]: BODY });
      await openApp(page);
      await findNote(page, "Keys");
      await page.keyboard.press("G");
      // The moves come before any edit, so no save's answer lands while they run.
      const moves: [string[], string][] = [
        [["$", "3", "|"], "echo foxtrot@2"],
        [["[", "["], "{ delta@0"],
        [["[", "["], "{ alpha@0"],
        [["]", "]"], "{ delta@0"],
        [["{"], "@0"],
        [["k"], "bravo@0"],
        [["}"], "@0"],
        [["j"], "charlie@0"],
      ];
      for (const [keys, at] of moves) {
        for (const key of keys)
          if (key in GERMAN) await typeAt(page, layout, key as keyof typeof GERMAN);
          else await page.keyboard.press(key);
        await expect.poll(() => cursor(page)).toBe(at);
      }
      await page.keyboard.press("r");
      await typeAt(page, layout, "|");
      for (const key of ["G", "0"]) await page.keyboard.press(key);
      await typeAt(page, layout, "~");
      for (const key of ["q", "q", "~", "q"]) await page.keyboard.press(key);
      await typeAt(page, layout, "@");
      await page.keyboard.press("q");
      const after = "{ alpha\nbravo\n\n|harlie\n{ delta\nECHo foxtrot";
      await expect.poll(async () => unstamped(await noteText(stack.vault, NOTE))).toContain(after);
      expect(await taken(page)).not.toContain(false);
    });

  for (const layout of ["windows", "linux", "mac"] as const)
    test(`on a ${layout} layout vim hands { } [ | @ ~ on in insert mode, and Ctrl+[ still leaves it`, async ({ page, stack }) => {
      // No heading: with one, CodeMirror's Ctrl-Alt-[ folds it on the windows shape (#2075).
      await vaultWith(stack.vault, { [NOTE]: `${STAMPS}---\nab` });
      await openApp(page);
      await findNote(page, "Keys");
      await page.keyboard.press("G");
      await page.keyboard.press("A");
      for (const char of ["{", "}", "[", "|", "@", "~"] as const) await typeAt(page, layout, char);
      // Chromium on Linux types no text held with Ctrl, so the windows shape proves only that vim let each press go.
      expect(await taken(page)).toEqual(Array(6).fill(false));
      await page.keyboard.press("Control+BracketLeft");
      await page.keyboard.press("x");
      // The editor closes each bracket as it opens, as it does for a plain {.
      const line = layout === "windows" ? "\na" : "\nab{}[|@]";
      await expect.poll(async () => (await noteText(stack.vault, NOTE)).endsWith(line)).toBe(true);
    });

  test("a Ctrl+Alt chord that types no letter stays a chord, and AltGr's € is no motion", async ({ page, stack }) => {
    await vaultWith(stack.vault, { [NOTE]: `${HEAD}echo` });
    await openApp(page);
    await findNote(page, "Keys");
    await page.keyboard.press("G");
    // Ctrl+Alt+A on Windows: `a` would append, and the ~ below would then be typed.
    await send(page, [["Control", "ControlLeft", CTRL], ["Alt", "AltLeft", CTRL | ALT], ["a", "KeyA", CTRL | ALT]]);
    await page.keyboard.press("~");
    // Read as `e`, € would move to the word's end and the ~ would turn the o.
    await typeAt(page, "windows", "€");
    await page.keyboard.press("~");
    await expect.poll(async () => unstamped(await noteText(stack.vault, NOTE))).toMatch(/\nECho$/);
  });
});
