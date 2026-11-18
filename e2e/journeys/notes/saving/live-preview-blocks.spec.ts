import type { Locator, Page } from "@playwright/test";
import {
  drawn,
  leader,
  noteText,
  openApp,
  phone,
  unstamped,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

/** Opens the note by URL and waits for its editor to draw the line holding `last`. */
async function opened(page: Page, path: string, last: string): Promise<Locator> {
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  const editor = page.locator(".cm-content", { hasText: last });
  await expect(editor.locator(".cm-line", { hasText: last })).toBeVisible({ timeout: 15_000 });
  return editor;
}

/** Each line as drawn: its text, the mark its `::before` hangs, and its inline indent. */
const lines = (editor: Locator) =>
  editor.locator(".cm-line").evaluateAll((all) =>
    all.map((line) => {
      const mark = getComputedStyle(line, "::before").content;
      const pad = (line as HTMLElement).style.paddingLeft;
      return [line.textContent, mark === "none" ? "" : mark, pad].join("|");
    }),
  );

/** The line holding `words`, as `lines` reads it but with `none` kept, and its typed mark's text. */
const line = (editor: Locator, words: string) =>
  editor
    .locator(".cm-line", { hasText: words })
    .evaluate((l) =>
      [
        l.textContent,
        getComputedStyle(l, "::before").content,
        (l as HTMLElement).style.paddingLeft,
        l.querySelector(".cm-list-mark")?.textContent ?? "",
      ].join("|"),
    );

// A shared list keeps its todo lines as lines; any other note's go to the store as embeds.
const SHARED = "05 Shared/";
const LISTS = "> quoted\n\n- first\n  - nested\n\n1. one\n   1. inner\n\na) ay\nb) bee\n";
const TODOS = "- [ ] open\n- [/] doing\n- [x] done\n- [b] blocked\n- [-] rejected\n- [[borges]]\n";

test.describe("with vim on", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "on"));
  });

  test("a note draws its quote, bullets, nested, numbered and lettered items and five todo states, marks hidden and each level indented", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { [`${SHARED}Lists.md`]: `${LISTS}\n${TODOS}` });
    const editor = await opened(page, `${SHARED}Lists.md`, "borges");
    expect(await lines(editor)).toEqual([
      "quoted||",
      "||",
      'first|"• "|1.6em',
      'nested|"• "|3.2em',
      "||",
      "1. one||1.6em",
      "1. inner||3.2em",
      "||",
      "a) ay||1.6em",
      "b) bee||1.6em",
      "||",
      'open|"☐ "|1.6em',
      'doing|"◐ "|1.6em',
      'done|"☑ "|1.6em',
      'blocked|"⊘ "|1.6em',
      'rejected|"☒ "|1.6em',
      'borges|"• "|1.6em',
      "||",
    ]);
    // The nesting spaces are hidden, so the indent drawn is what moves the text.
    const left = (words: string) =>
      editor.locator(".cm-line", { hasText: words }).evaluate((l) => {
        const range = document.createRange();
        range.selectNodeContents(l.lastChild as Node);
        return range.getBoundingClientRect().left;
      });
    expect(await left("nested")).toBeGreaterThan(await left("first"));
  });

  test("x after 0 on a todo deletes its first word's letter, the hidden box left alone on disk", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { [`${SHARED}Box.md`]: "- [ ] task\n" });
    const editor = await opened(page, `${SHARED}Box.md`, "task");
    await editor.click();
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await page.keyboard.press("0");
    await page.keyboard.press("x");
    await expect(page.locator(".cm-line", { hasText: /^ask$/ })).toBeVisible();
    await expect
      .poll(async () => unstamped(await noteText(stack.vault, `${SHARED}Box.md`)), {
        timeout: 15_000,
      })
      .toContain("- [ ] ask\n");
  });

  const PARTS = [
    "- [/] parent",
    "  - [x] one",
    "  - [-] two",
    "  - [ ] three",
    "    - [x] four",
    "    - [ ] five",
  ];
  const COUNTS: [string, string[], string[]][] = [
    ["parts and grandchildren", PARTS, ["parent3/5", "three1/2"]],
    ["a part past a heading", ["- [ ] r", "", "## Other", "  - [ ] far away"], []],
    ["a part past a plain item", ["- [ ] r", "- plain", "  - [ ] far away"], []],
    ["a part inside a fence", ["- [ ] r", "  ```", "  - [ ] far away", "  ```"], []],
    [
      "a part under a heading",
      ["## Week", "- [ ] r", "  - [x] near", "- plain", "## Other", "- [ ] s"],
      ["r1/1"],
    ],
    ["todos nested under nothing", ["- [ ] one", "- [x] two", "- [ ] three"], []],
  ];
  for (const [name, doc, counts] of COUNTS) {
    test(`#1445 a parent's count reads only its own parts: ${name}`, async ({ page, stack }) => {
      await vaultWith(stack.vault, { [`${SHARED}Parts.md`]: `${doc.join("\n")}\n` });
      const editor = await opened(
        page,
        `${SHARED}Parts.md`,
        doc.at(-1)?.trim().slice(6) || "far away",
      );
      // Drawn as todos, so an empty count list is not an editor that drew nothing.
      await expect(editor.locator(".cm-todo").first()).toBeVisible();
      const shown = await editor
        .locator(".cm-line:has(.cm-todo-progress)")
        .evaluateAll((all) => all.map((l) => l.textContent));
      expect(shown).toEqual(counts);
    });
  }

  test("a first parse that ran out of time draws every bullet once the rest of the parse lands, no key pressed", async ({
    page,
    stack,
  }) => {
    const doc = Array.from({ length: 10 }, (_, n) => `- item ${n}`).join("\n");
    await vaultWith(stack.vault, { "Starved.md": `${doc}\n` });
    // A clock that leaps a second each read spends CodeMirror's 20 ms first parse at once, as a
    // loaded machine can (#365); it runs true again once the note's first line is on the page.
    await page.addInitScript(() => {
      const real = Date.now;
      let now = real();
      Date.now = () => (now += 1000);
      new MutationObserver((_, observer) => {
        const all = [...document.querySelectorAll(".cm-content")];
        if (!all.some((c) => c.textContent?.includes("item 0"))) return;
        Object.assign(window, { early: document.querySelectorAll(".cm-bullet").length });
        Date.now = real;
        observer.disconnect();
      }).observe(document, { childList: true, subtree: true });
    });
    const editor = await opened(page, "Starved.md", "item 9");
    expect(await page.evaluate(() => (window as unknown as { early: number }).early)).toBeLessThan(
      10,
    );
    await expect(editor.locator(".cm-bullet")).toHaveCount(10);
  });
});

for (const vim of ["on", "off"]) {
  test(`with vim ${vim} the line being edited shows its dash, nested indent and todo box as typed, and the other lines stay drawn`, async ({
    page,
    stack,
  }) => {
    await page.addInitScript((v) => localStorage.setItem("kasten.vim", v), vim);
    await vaultWith(stack.vault, { [`${SHARED}Edit.md`]: "- first\n  - nested\n- [/] task\n" });
    const editor = await opened(page, `${SHARED}Edit.md`, "task");
    /** Puts the cursor on the line holding `words`; vim's normal mode then enters insert. */
    const edit = async (words: string) => {
      if (vim === "on") await page.keyboard.press("Escape");
      await editor.locator(".cm-line", { hasText: words }).click({ position: { x: 200, y: 5 } });
      if (vim === "on") await page.keyboard.press("i");
    };
    await edit("first");
    await expect.poll(() => line(editor, "first")).toBe("- first|none|1.6em|- ");
    await expect(editor.locator(".cm-bullet")).toHaveCount(1);

    await edit("nested");
    await expect.poll(() => line(editor, "nested")).toBe("- nested|none|3.2em|- ");
    expect(await line(editor, "first")).toBe('first|"• "|1.6em|');

    await edit("task");
    await expect.poll(() => line(editor, "task")).toBe("- [/] task|none|1.6em|- ");
    await expect(editor.locator(".cm-todo")).toHaveCount(0);
  });
}

test.describe("on a phone", () => {
  test.use(phone);

  test("a tap on a bullet shows its dash, and the todo beside it stays drawn", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { [`${SHARED}Tap.md`]: "- first\n- second\n- [x] done\n" });
    const editor = await opened(page, `${SHARED}Tap.md`, "done");
    await editor.locator(".cm-line", { hasText: "second" }).tap({ position: { x: 150, y: 5 } });
    await expect.poll(() => line(editor, "second")).toBe("- second|none|1.6em|- ");
    expect(await line(editor, "first")).toBe('first|"• "|1.6em|');
    expect(await line(editor, "done")).toBe('done|"☑ "|1.6em|');
  });

  test("a note draws its links as their text, a dead one muted, and a plain [text] with its brackets", async ({
    page,
    stack,
  }) => {
    const note =
      "see [the docs](https://example.com) now\n\n[[borges]] and [[ficciones]]\n\n[text]\n";
    await vaultWith(stack.vault, { "Links.md": note, "borges.md": "Jorge\n" });
    await opened(page, "Links.md", "text");
    await expect
      .poll(() => drawn(page))
      .toEqual(["see <L:the docs> now", "<L:borges> and <D:ficciones>", "[text]"]);
  });
});

const ROWS = [
  "| h | i |",
  "| - | - |",
  "| a \\| b | **a \\| b** |",
  "| a \\* b | a \\_ b |",
  "| a \\[ b | a \\\\ b |",
  "| [a \\* b](https://x.y) | *a \\_ b* |",
  "| `a \\| b` | a \\| `b` |",
  "| `a\\b` | x |",
];
const PLAIN = ["a \\* b", "a \\_ b", "a \\[ b", "a \\| b", "x `a \\| b` y"];
const ESCAPES = `intro\n\n${ROWS.join("\n")}\n\n${PLAIN.join("\n\n")}\n`;

/** The text each of a cell's spans wearing `selector` holds, joined: an escape cuts a run into spans. */
const worn = (cell: Locator, selector: string) =>
  cell.locator(selector).evaluateAll((all) => all.map((s) => s.textContent).join(""));

for (const vim of ["on", "off"]) {
  test(`#512 #515 with vim ${vim} a table cell draws each escape as its character alone, and the cursor in the table shows the source as written`, async ({
    page,
    stack,
  }) => {
    await page.addInitScript((v) => localStorage.setItem("kasten.vim", v), vim);
    await vaultWith(stack.vault, { "Escapes.md": ESCAPES });
    const editor = await opened(page, "Escapes.md", "intro");
    const cells = editor.locator(".cm-table-grid tbody td");
    await expect(cells).toHaveText([
      "a | b",
      "a | b",
      "a * b",
      "a _ b",
      "a [ b",
      "a \\ b",
      "a * b",
      "a _ b",
      "a | b",
      "a | b",
      "a\\b",
      "x",
    ]);
    expect(await worn(cells.nth(1), ".cm-strong")).toBe("a | b");
    expect(await worn(cells.nth(6), ".cm-link")).toBe("a * b");
    expect(await worn(cells.nth(7), ".cm-emphasis")).toBe("a _ b");
    expect(await worn(cells.nth(8), ".cm-inline-code")).toBe("a | b");
    // Off a table an escape already showed its character alone, and a code span keeps its backslash.
    const shown = await editor
      .locator(".cm-line")
      .evaluateAll((all) => all.map((l) => l.textContent));
    expect(shown.slice(-PLAIN.length * 2)).toEqual(
      ["a * b", "a _ b", "a [ b", "a | b", "x a \\| b y"].flatMap((l) => [l, ""]),
    );

    await cells.nth(2).click();
    await expect(editor.locator(".cm-table-grid")).toHaveCount(0);
    const source = await editor
      .locator(".cm-line")
      .evaluateAll((all) => all.slice(2, 2 + 8).map((l) => l.textContent));
    expect(source).toEqual(ROWS);
    expect(unstamped(await noteText(stack.vault, "Escapes.md"))).toBe(ESCAPES);
  });
}

test("#512 a table cell in the finder's reading preview draws an escaped bar as the bar alone", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { "Escapes.md": ESCAPES });
  await openApp(page);
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await page.keyboard.type("Escapes");
  await expect(finder.getByRole("option", { selected: true })).toContainText("Escapes");
  await expect(finder.getByTestId("preview").locator(".cm-table-grid tbody td").first()).toHaveText(
    "a | b",
  );
});

test.describe("on a phone, tables", () => {
  test.use(phone);

  test("#512 a tap on a table cell drawn with an escaped bar shows its row as written", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "Escapes.md": ESCAPES });
    const editor = await opened(page, "Escapes.md", "intro");
    const cell = editor.locator(".cm-table-grid tbody td").first();
    await expect(cell).toHaveText("a | b");
    await cell.tap();
    await expect(editor.locator(".cm-line", { hasText: "**a \\| b**" })).toHaveText(ROWS[2] ?? "");
  });
});

/** Each element as drawn: text, side, then c for the code font, m for muted, and a muted `::before`. */
const seen = (all: Locator) =>
  all.evaluateAll((els) => {
    const probe = document.createElement("i");
    probe.style.cssText = "color: var(--k-muted); font-family: var(--k-mono)";
    document.body.append(probe);
    const muted = getComputedStyle(probe);
    const flag = (s: CSSStyleDeclaration) =>
      (s.fontFamily === muted.fontFamily ? "c" : "") + (s.color === muted.color ? "m" : "");
    const read = els.map((el) => {
      const [s, before] = [getComputedStyle(el), getComputedStyle(el, "::before")];
      const dash = before.content === "none" ? "" : before.content + flag(before);
      return [el.textContent, s.textAlign, flag(s), dash].join("|");
    });
    probe.remove();
    return read;
  });

const GRID = [
  "| a | **b** | c |",
  "| :-- | :-: | --: |",
  "| 1 |  | 3 |",
  "| 4 | - | – |",
  "",
  "| item | qty | price |",
  "| --- | --- | --- |",
  "| WH-07 | 10 | $2.50 |",
  "| tea | -3 |  |",
  "| `ab` | +1,200 | 4,00 € |",
  "| us-east-1 | 7 | 1 |",
  "| 2026-10-24 | 8 | 2 |",
  "Table: Totals in euros",
];

for (const vim of ["on", "off", "phone"]) {
  const kind = vim === "phone" ? "on a phone" : `with vim ${vim}`;
  test.describe(kind, () => {
    if (vim === "phone") test.use(phone);
    else
      test.beforeEach(({ page }) =>
        page.addInitScript((v) => localStorage.setItem("kasten.vim", v), vim),
      );

    test(`#792 tables draw their sides, marks, empty and dash cells, code cells and caption, no source shown`, async ({
      page,
      stack,
    }) => {
      await vaultWith(stack.vault, { "Grid.md": `before\n\n${GRID.join("\n")}\n` });
      const editor = await opened(page, "Grid.md", "before");
      const grids = editor.locator(".cm-table-grid");
      await expect(grids).toHaveCount(2);
      // Explicit sides first, a typed dash muted like the empty cell's drawn one.
      expect(await seen(grids.first().locator("th, td"))).toEqual(
        ["a|left||", "b|center||", "c|right||", "1|left||", '|center||"‒"m', "3|right||"].concat([
          "4|left||",
          "-|center|m|",
          "–|right|m|",
        ]),
      );
      // Numbers right with their head, code-like names in the code font, a word and a date not.
      expect(await seen(grids.nth(1).locator("th, td"))).toEqual(
        ["item|left||", "qty|right||", "price|right||", "WH-07|left|c|", "10|right||"].concat(
          ["$2.50|right||", "tea|left||", "-3|right||", '|right||"‒"m', "ab|left|c|"],
          ["+1,200|right||", "4,00 €|right||", "us-east-1|left|c|", "7|right||", "1|right||"],
          ["2026-10-24|left||", "8|right||", "2|right||"],
        ),
      );
      const caption = editor.locator(".cm-line", { hasText: "Totals" });
      expect(await seen(caption)).toEqual(["Totals in euros|start|m|"]);
      expect(await editor.textContent()).not.toMatch(/[|*`]|Table: /);
    });

    test(`a note that is only a table opens on its source, the cursor being in it`, async ({
      page,
      stack,
    }) => {
      const rows = ["| a | b |", "| - | - |", "| 1 | 2 |"];
      await vaultWith(stack.vault, { "Only.md": `${rows.join("\n")}\n` });
      const editor = await opened(page, "Only.md", "| 1 | 2 |");
      await expect(editor.locator(".cm-table-grid")).toHaveCount(0);
      expect(await editor.locator(".cm-line").allTextContents()).toEqual([...rows, ""]);
    });
  });
}

test("#968 a cell's links draw their alias, a folder's note name, a kept slash, and an escaped bar's link opens its note", async ({
  page,
  stack,
}) => {
  const cells = "[[borges#Life\\|Jorge]] | [[01 Periodic/00 Daily/2026-11-09#Log]] | [[notes/]]";
  const more = "[[borges\\|]] | [[/]] | [[\\|]] | [[Target\\|shown]]";
  await vaultWith(stack.vault, {
    "borges.md": "Jorge\n",
    "Target.md": "the target's own body\n",
    "Links.md": `before\n\n| a | b | c | d | e | f | g |\n${"| - ".repeat(7)}|\n| ${cells} | ${more} |\n`,
  });
  const editor = await opened(page, "Links.md", "before");
  const links = editor.locator(".cm-table-grid tbody .cm-wikilink");
  // A dead link draws muted only once the file list is in, which can land after the table draws (#2142).
  await expect
    .poll(() => seen(links))
    .toEqual(
      ["Jorge|left||", "2026-11-09#Log|left|cm|", "notes/|left|m|", "borges|left||"].concat([
        "/|left|m|",
        "||left||",
        "shown|left||",
      ]),
    );
  await links.last().click({ modifiers: ["Control"] });
  await expect(page.locator(".cm-line", { hasText: "the target's own body" })).toBeVisible();
});

test("a table that opens a note draws in the finder's reading preview, and the prose under it stays prose", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, {
    "Prose.md": "| a | b |\n| - | - |\n| 1 | 2 |\nafter the table `code`\n",
  });
  await openApp(page);
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await page.keyboard.type("Prose");
  await expect(finder.getByRole("option", { selected: true })).toContainText("Prose");
  const preview = finder.getByTestId("preview");
  await expect(preview.locator(".cm-table-grid tbody tr")).toHaveText(["12"]);
  expect(await seen(preview.locator(".cm-line:not(:has(table))"))).toEqual([
    "after the table code|start||",
    "|start||",
  ]);
  expect(await seen(preview.locator(".cm-inline-code"))).toEqual(["code|start|c|"]);
  expect(await preview.textContent()).not.toMatch(/[|`]/);
});
