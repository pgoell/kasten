import type { Page } from "@playwright/test";
import {
  caretLine,
  noteText,
  onPhone,
  phone,
  runCommand,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { beside, layout, load, seed, stored } from "../../panes/workspace/stored.ts";

const VIM = "kasten.vim";
// A frontmatter from the start, so the stamp a first save writes moves no line.
const FM = "---\nid: vim\n---\n";
const TWO = `${FM}line one\nline two\n`;

/** Opens `path` holding `text`, the vim choice stored first when given, the cursor on its first line. */
async function open(page: Page, vault: string, text: string, vim?: string, path = "Vim.md") {
  await vaultWith(vault, { [path]: text, "reading/borges.md": "# The Aleph\n" });
  if (vim) await page.addInitScript(([key, on]) => localStorage.setItem(key, on), [VIM, vim]);
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  const content = page.locator(".cm-content:visible");
  await expect(content).toBeVisible({ timeout: 15_000 });
  if (onPhone(page))
    await content
      .locator(".cm-line")
      .nth(text.startsWith("---") ? 1 : 0)
      .tap();
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

/** `dd` at the line's head: vim deletes the line, a plain editor types the letters. */
async function dd(page: Page): Promise<void> {
  await page.keyboard.press("Home");
  await page.keyboard.type("dd");
}

/** The drawn lines of the editor in `within` below its frontmatter's one line. */
const body = async (within: Page | ReturnType<Page["locator"]>) =>
  (await within.locator(".cm-content .cm-line").allTextContents()).slice(1);

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test.describe("vim by pointer, or by a choice made by hand", () => {
  for (const [vim, first] of [
    [undefined, "line two"],
    ["off", "ddline one"],
  ] as const) {
    test(`a desktop with ${vim ?? "no choice"} stored ${vim ? "leaves vim out" : "runs vim"}`, async ({
      page,
      stack,
    }) => {
      await open(page, stack.vault, TWO, vim);
      await dd(page);
      await expect.poll(async () => (await body(page))[0]).toBe(first);
    });
  }

  test.describe("on a phone", () => {
    test.use(phone);
    for (const [vim, first] of [
      [undefined, "ddline one"],
      ["on", "line two"],
    ] as const) {
      test(`with ${vim ?? "no choice"} stored ${vim ? "vim runs" : "vim stays out"}`, async ({
        page,
        stack,
      }) => {
        await open(page, stack.vault, TWO, vim);
        await dd(page);
        await expect.poll(async () => (await body(page))[0]).toBe(first);
      });
    }
  });
});

test("the palette row turns vim off and on, stores it, and keeps the view, text, cursor and undo", async ({
  page,
  stack,
}) => {
  await open(page, stack.vault, `${FM}one\ntwo\nthree\n`);
  await page.keyboard.press("j");
  await page.keyboard.type("dd");
  await expect(caretLine(page)).toHaveText("three");
  await page.locator(".cm-editor:visible").evaluate((view) => view.setAttribute("data-kept", ""));
  // Ctrl+Shift+P from the editor with vim on, past vim's own keymap.
  await runCommand(page, /Toggle vim keys/);
  expect(await stored(page, VIM)).toBe("off");
  await expect(page.locator(".cm-editor[data-kept]:visible .cm-content:focus")).toHaveCount(1);
  await expect(caretLine(page)).toHaveText("three");
  await page.keyboard.press("Control+z");
  await expect.poll(() => body(page)).toEqual(["one", "two", "three", ""]);
  await dd(page);
  await expect(caretLine(page)).toHaveText("ddthree");
  // And Ctrl+Shift+P from the editor with vim off.
  await runCommand(page, /Toggle vim keys/);
  expect(await stored(page, VIM)).toBe("on");
  await page.keyboard.type("dd");
  await expect.poll(() => body(page)).toEqual(["one", "two", ""]);
});

test("with vim off the cursor line shows its marks, and vim turned on hides them in normal mode until i", async ({
  page,
  stack,
}) => {
  await open(page, stack.vault, `${FM}## Notes\n\nplain\n`, "off");
  await expect(caretLine(page)).toHaveText("## Notes");
  await runCommand(page, /Toggle vim keys/);
  await expect(caretLine(page)).toHaveText("Notes");
  await page.keyboard.press("i");
  await expect(caretLine(page)).toHaveText("## Notes");
});

test("a toggle reaches both panes of this tab and the editor of another tab at once", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { "Other.md": TWO });
  const other = await page.context().newPage();
  await open(other, stack.vault, TWO);
  await seed(page, layout([beside({ path: "Vim.md" }, { path: "Other.md" })]));
  await load(page);
  const panes = page.locator("[data-pane]:visible");
  await panes.nth(0).locator(".cm-line").nth(1).click();
  await runCommand(page, /Toggle vim keys/);
  // Typed into the other tab with no render between: only the storage event can have told it.
  await dd(other);
  await expect.poll(async () => (await body(other))[0]).toBe("ddline one");
  for (const n of [0, 1]) {
    await panes.nth(n).locator(".cm-line").nth(1).click();
    await dd(page);
    await expect.poll(async () => (await body(panes.nth(n)))[0]).toBe("ddline one");
  }
});

test.describe("a browser that refuses storage", () => {
  /** Makes storage throw on `kasten.vim` alone, for reads or for writes while `window.blocked` holds. */
  const refuse = (page: Page, how: "getItem" | "setItem") =>
    page.addInitScript(
      ([key, method]) => {
        if (method === "getItem") localStorage.setItem(key, "off");
        Object.assign(window, { blocked: true });
        const real = Storage.prototype[method] as (...a: string[]) => string | null;
        Storage.prototype[method] = function (this: Storage, ...args: string[]) {
          if (args[0] === key && (window as unknown as { blocked: boolean }).blocked) {
            throw new DOMException("refused by the test", "SecurityError");
          }
          return real.apply(this, args);
        } as never;
      },
      [VIM, how] as const,
    );

  test("that throws on a read runs vim by the pointer, past an off it holds", async ({
    page,
    stack,
  }) => {
    await refuse(page, "getItem");
    await open(page, stack.vault, TWO);
    await dd(page);
    await expect.poll(async () => (await body(page))[0]).toBe("line two");
  });

  test("that throws on a write still turns vim off for the page, and stores the next toggle once it can", async ({
    page,
    stack,
  }) => {
    await refuse(page, "setItem");
    await open(page, stack.vault, TWO);
    await runCommand(page, /Toggle vim keys/);
    await page.evaluate(() => Object.assign(window, { blocked: false }));
    expect(await stored(page, VIM)).toBeNull();
    await dd(page);
    await expect.poll(async () => (await body(page))[0]).toBe("ddline one");
    await runCommand(page, /Toggle vim keys/);
    expect(await stored(page, VIM)).toBe("on");
  });
});

test("with vim off the chords wrap the word, the rest stays drawn, and ctrl+s and Write the note write at once", async ({
  page,
  stack,
}) => {
  await page.clock.install();
  await open(page, stack.vault, `${FM}word\n\n**bold** text\n`, "off");
  await expect(page.locator(".cm-content:visible .cm-line", { hasText: "bold" })).toHaveText(
    "bold text",
  );
  // The autosave waits 800 ms of quiet; a paused clock that moves under that leaves it unsent.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  const lands = async (text: string) => {
    for (
      let ms = 0;
      ms < 500 && !(await noteText(stack.vault, "Vim.md")).includes(text);
      ms += 50
    ) {
      await page.clock.runFor(50);
    }
    expect(await noteText(stack.vault, "Vim.md")).toContain(text);
  };
  await page.keyboard.press("Control+b");
  await expect(caretLine(page)).toHaveText("**word**");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Control+i");
  await expect(caretLine(page)).toHaveText("*word*");
  await page.keyboard.press("Control+i");
  await page.keyboard.press("Control+Shift+X");
  await expect(caretLine(page)).toHaveText("~~word~~");
  await page.keyboard.press("Control+s");
  await lands("\n~~word~~\n");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await runCommand(page, /^Write the note/);
  await lands("\n~~word~~!\n");
});

test("the palette rereads the note: refused over a write still out, and with the bang it takes the vault's text", async ({
  page,
  stack,
}) => {
  await open(page, stack.vault, `${FM}line one\n`, "off");
  let out = false;
  let letGo = () => {};
  const gate = new Promise<void>((done) => (letGo = done));
  await page.route(/\/api\/files\/Vim\.md$/, async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    out = true;
    await gate;
    await route.fallback();
  });
  await page.keyboard.press("End");
  await page.keyboard.type(" typed");
  await expect.poll(() => out).toBe(true);
  await runCommand(page, /^Read the note off the vault again(?!,)/);
  await expect(caretLine(page)).toHaveText("line one typed");
  await runCommand(page, /^Read the note off the vault again, throwing away unsaved text/);
  await expect(page.locator(".cm-content:visible")).not.toContainText("typed");
  letGo();
});

test.describe("the copy rows", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const copied: string[] = [];
      const writeText = async (text: string) => void copied.push(text);
      Object.assign(window, { copied });
      Object.defineProperty(navigator, "clipboard", { value: { writeText } });
    });
  });
  const copied = (page: Page) =>
    page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  /** Selects `n` characters from the head of the cursor's line. */
  const select = async (page: Page, n: number) => {
    await page.keyboard.press("Home");
    for (let i = 0; i < n; i++) await page.keyboard.press("Shift+ArrowRight");
  };

  test("copy the whole note for Slack, or the selection as markdown, and say so", async ({
    page,
    stack,
  }) => {
    await open(page, stack.vault, "**bold** and more", "off");
    await runCommand(page, /^Copy for Slack/);
    await expect(page.getByText("Copied for Slack")).toBeVisible();
    await select(page, 8);
    await runCommand(page, /^Copy as markdown/);
    await expect.poll(() => copied(page)).toEqual(["*bold* and more", "**bold**"]);
  });

  test("copy a selected reference link for Slack with the note's definition (A9)", async ({
    page,
    stack,
  }) => {
    await open(page, stack.vault, "see [docs] here\n\n[docs]: https://example.com", "off");
    await select(page, "see [docs] here".length);
    await runCommand(page, /^Copy for Slack/);
    await expect.poll(() => copied(page)).toEqual(["see docs (https://example.com) here"]);
  });

  test("copy an embed without its bang for Slack and as written as markdown", async ({
    page,
    stack,
  }) => {
    await open(page, stack.vault, "![[borges]]", "off");
    await runCommand(page, /^Copy for Slack/);
    await runCommand(page, /^Copy as markdown/);
    await expect.poll(() => copied(page)).toEqual(["borges", "![[borges]]"]);
  });
});

test("the palette follows the link under the cursor, and goes to a tab by number, its row teaching Space 3", async ({
  page,
  stack,
}) => {
  await open(page, stack.vault, "[[reading/borges]]", "off");
  await runCommand(page, /^Open what the wikilink or highlight under the cursor names/);
  await expect(page.getByRole("tab", { selected: true })).toContainText("borges");
  await runCommand(page, /^Create a tab/);
  await runCommand(page, /^Create a tab/);
  await runCommand(page, /^Go to tab 1(?!\d)/);
  await page.keyboard.press("Control+Shift+P");
  const row = page.getByRole("option", { name: /^Go to tab 3(?!\d)/ });
  await expect(row).toContainText("Space 3");
  await row.click();
  await expect(page.getByRole("tablist").first().getByRole("tab").nth(2)).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test.describe("on a phone with vim off", () => {
  test.use(phone);

  test("a tap in the wikilink the cursor is in leaves it to the cursor", async ({
    page,
    stack,
  }) => {
    await open(page, stack.vault, "[[reading/borges]]");
    await expect(caretLine(page)).toHaveText("[[reading/borges]]");
    await page.locator(".cm-content:visible").getByText("reading/borges").tap();
    await expect(page.getByRole("tab", { selected: true })).toContainText("Vim");
  });

  test("a tap in the markdown link the cursor is in opens nothing", async ({ page, stack }) => {
    await page.addInitScript(() =>
      Object.assign(window, {
        opened: [],
        open: (u: string) => (window as unknown as { opened: string[] }).opened.push(u) && null,
      }),
    );
    await open(page, stack.vault, "[mail](https://mail.example)");
    await page.locator(".cm-content:visible").getByText("mail", { exact: true }).tap();
    expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual(
      [],
    );
  });
});
