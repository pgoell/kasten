import type { Page } from "@playwright/test";
import { findNote, noteText, openApp, TODO_ROW, unstamped, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

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
  "\\": ["Minus", "Digit7"],
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

/** CodeMirror and the editor read the platform once: a Mac's vim drops a lone Alt, and only Windows reads AltGr as Ctrl+Alt. */
async function platformOf(page: Page, title: string) {
  const platform = title.includes("mac") ? "MacIntel" : title.includes("windows") ? "Win32" : undefined;
  if (platform) await page.addInitScript((p) => Object.defineProperty(Navigator.prototype, "platform", { get: () => p }), platform);
}
/** Records each keydown of a character typed with AltGr or Option, so a journey can read who took it. */
async function watchTyped(page: Page) {
  await page.addInitScript(() => {
    const typed: KeyboardEvent[] = [];
    Object.assign(window, { typed });
    window.addEventListener("keydown", (e) => e.key.length === 1 && "@~{}[]|€\\".includes(e.key) && typed.push(e), true);
  });
}
/** The cursor's line number, text and column, off CodeMirror's own view, which the bundle reaches only through its DOM. */
const cursor = (page: Page) =>
  page.locator(".cm-content:visible").evaluate((el) => {
    type State = { selection: { main: { head: number } }; doc: { lineAt(at: number): { text: string; from: number } } };
    const { state } = (el as unknown as { cmTile: { root: { view: { state: State } } } }).cmTile.root.view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    return `${line.number}:${line.text}@${head - line.from}`;
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
    await platformOf(page, test.info().title);
  });

  for (const layout of ["windows", "linux", "mac"] as const)
    test(`on a ${layout} layout [[ ]] { } | r| ~ and @q act in normal mode and type nothing`, async ({ page, stack }) => {
      await vaultWith(stack.vault, { [NOTE]: BODY });
      await openApp(page);
      await findNote(page, "Keys");
      await page.keyboard.press("G");
      // No j or k: right after the windows shape they can land at the note's end (#2076).
      const moves: [string[], string][] = [
        [["[", "["], "13:{ delta@0"],
        [["[", "["], "9:{ alpha@0"],
        [["]", "]"], "13:{ delta@0"],
        [["{"], "11:@0"],
        [["{"], "8:@0"],
        [["}"], "11:@0"],
        [["G", "$", "3", "|"], "14:echo foxtrot@2"],
        [["r", "|"], "14:ec|o foxtrot@2"],
      ];
      for (const [keys, at] of moves) {
        for (const key of keys)
          if (key in GERMAN) await typeAt(page, layout, key as keyof typeof GERMAN);
          else await page.keyboard.press(key);
        await expect.poll(() => cursor(page)).toBe(at);
      }
      await page.keyboard.press("0");
      await typeAt(page, layout, "~");
      for (const key of ["q", "q", "~", "q", "l"]) await page.keyboard.press(key);
      await typeAt(page, layout, "@");
      await page.keyboard.press("q");
      const after = "{ alpha\nbravo\n\ncharlie\n{ delta\nEC|O foxtrot";
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

/**
 * The windows shape with its character typed: the keydown holds Ctrl+Alt as Windows sends it, and the
 * text follows as its own char event with no flag, since Chromium on Linux types nothing held with Ctrl.
 * Chromium drops that char when a keydown handler takes the press, as it does on Windows.
 */
async function typeWindows(page: Page, char: keyof typeof GERMAN) {
  const [ctrl, altGr, [key, code, modifiers]] = presses("windows", char);
  const cdp = await page.context().newCDPSession(page);
  for (const [k, c, m] of [ctrl, altGr]) await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: c, modifiers: m });
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "char", key, code, text: key, modifiers: 0 });
  for (const [k, c, m] of [[key, code, modifiers], altGr, ctrl] as const)
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: c, modifiers: m });
  await cdp.detach();
}

test.describe("CodeMirror's Ctrl+Alt keys and [ ] \\ typed through AltGr or Option (#2075)", () => {
  const NOTE = "Folds.md";
  const STAMPS = "---\nid: 01a1df77-0000-7000-8000-000000002075\ncreated: 2026-11-15T13:00:00+00:00\ntype: Note\n";
  // Two headings, so Ctrl-Alt-[ has a fold to make and Ctrl-Alt-] one to undo.
  const BODY = `${STAMPS}modified: 2026-11-15T13:00:00+00:00\n---\n# Folds\n\none\n\n## Two\n\ntwo `;
  test.beforeEach(async ({ page }) => {
    await watchTyped(page);
    await platformOf(page, test.info().title);
  });

  for (const vim of ["on", "off"] as const)
    for (const layout of ["windows", "linux", "mac"] as const)
      test(`vim ${vim}, [ ] \\ typed on a ${layout} layout type themselves, and fold or indent nothing`, async ({
        page,
        stack,
      }) => {
        await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
        await vaultWith(stack.vault, { [NOTE]: BODY });
        await openApp(page);
        await page.getByRole("button", { name: "Folds", exact: true }).click();
        await page.locator(".cm-line", { hasText: /^two/ }).click();
        await page.keyboard.press("End");
        if (vim === "on") await page.keyboard.press("A");
        for (const char of ["[", "]", "\\"] as const)
          if (layout === "windows") await typeWindows(page, char);
          else await typeAt(page, layout, char);
        // The editor pairs a [ and steps over the ] typed next, as it does for a plain [.
        await expect.poll(async () => unstamped(await noteText(stack.vault, NOTE))).toMatch(/\ntwo \[\]\\$/);
        expect(await taken(page)).toEqual([false, false, false]);
        await expect(page.locator(".cm-foldPlaceholder")).toHaveCount(0);
      });

  test("vim off, the Ctrl, Alt and Ctrl+Alt chords that type no character keep their bindings", async ({ page, stack }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await vaultWith(stack.vault, { [NOTE]: BODY });
    await openApp(page);
    await page.getByRole("button", { name: "Folds", exact: true }).click();
    await page.locator(".cm-line", { hasText: /^two/ }).click();
    // Off Windows Ctrl+Alt is no AltGr, so Ctrl-Alt-[ folds all and Ctrl-Alt-] unfolds.
    await page.keyboard.press("Control+Alt+BracketLeft");
    await expect(page.locator(".cm-foldPlaceholder")).not.toHaveCount(0);
    await page.keyboard.press("Control+Alt+BracketRight");
    await expect(page.locator(".cm-foldPlaceholder")).toHaveCount(0);
    await page.locator(".cm-line", { hasText: /^two/ }).click();
    // Alt-ArrowUp moves the line up, Ctrl-] indents it.
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.press("Control+BracketRight");
    await expect.poll(async () => unstamped(await noteText(stack.vault, NOTE))).toMatch(/\n## Two\n\s+two \n$/);
    // Ctrl-Alt-ArrowUp adds a cursor above.
    await page.keyboard.press("Control+Alt+ArrowUp");
    await expect(page.locator(".cm-cursor-secondary")).toHaveCount(1);
    await page.keyboard.press("Escape");
    // Ctrl-Shift-[ folds the heading the cursor is on.
    await page.locator(".cm-line", { hasText: /^## Two/ }).click();
    await page.keyboard.press("Control+Shift+BracketLeft");
    await expect(page.locator(".cm-foldPlaceholder")).toHaveCount(1);
    // Ctrl+Alt+G the Windows way, a letter and so a chord: go to line.
    await send(page, [["Control", "ControlLeft", CTRL], ["Alt", "AltLeft", CTRL | ALT], ["g", "KeyG", CTRL | ALT]]);
    await expect(page.getByRole("textbox", { name: /Go to line/ })).toBeVisible();
  });
});
