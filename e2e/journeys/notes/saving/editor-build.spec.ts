import type { Locator, Page } from "@playwright/test";
import {
  caretLine,
  drawn,
  hold,
  inbox,
  openApp,
  opened,
  openNote,
  phone,
  recordOpens,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

type Probe = {
  fontReads: Element[][];
  joined: { dom: Element; config: unknown }[];
};

// CodeMirror's own back-reference from its DOM to the view, the one `EditorView.findFromDOM`
// reads; the bundle hides the class, so the journey goes through it.
type Tiled = { cmTile?: { root?: { view?: { state: { config: unknown } } } } };

/** Records, from before the app loads, each fonts read and each editor as it joins the page. */
async function watchEditors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: Probe = { fontReads: [], joined: [] };
    Object.assign(window, { probe });
    const ready = Object.getOwnPropertyDescriptor(FontFaceSet.prototype, "ready");
    Object.defineProperty(FontFaceSet.prototype, "ready", {
      configurable: true,
      get() {
        probe.fontReads.push([...document.querySelectorAll(".cm-editor")]);
        return ready?.get?.call(this);
      },
    });
    // Synchronous at the join, so the config is read before the mount's later effects run.
    const append = Element.prototype.append;
    Element.prototype.append = function (...nodes) {
      append.apply(this, nodes);
      for (const node of nodes) {
        if (!(node instanceof Element) || !node.classList.contains("cm-editor")) continue;
        const content = node.querySelector(".cm-content") as unknown as Tiled | null;
        probe.joined.push({ dom: node, config: content?.cmTile?.root?.view?.state.config });
      }
    };
  });
}

/** Whether the shown editor holds the configuration it joined the page with. */
function sameConfig(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const { probe } = window as unknown as { probe: Probe };
    const editor = [...document.querySelectorAll(".cm-editor")].find((e) => e.checkVisibility());
    const content = editor?.querySelector(".cm-content") as unknown as Tiled | null;
    const joined = probe.joined.find((j) => j.dom === editor);
    return joined !== undefined && joined.config === content?.cmTile?.root?.view?.state.config;
  });
}

/** Loads the app with vim off and the editors watched, over a vault holding Plain. */
async function start(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, { "Plain.md": "intro\n" });
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await watchEditors(page);
  await openApp(page);
}

test("a note's editor reads the fonts while its view is still off the page", async ({
  page,
  stack,
}) => {
  await start(page, stack.vault);
  const before = await page.evaluate(
    () => (window as unknown as { probe: Probe }).probe.fontReads.length,
  );
  await openNote(page, "Plain");

  const reads = await page.evaluate(() => {
    const { probe } = window as unknown as { probe: Probe };
    const editor = [...document.querySelectorAll(".cm-editor")].find((e) => e.checkVisibility());
    return probe.fontReads.map((seen) => editor !== undefined && seen.includes(editor));
  });
  expect(reads.length).toBeGreaterThan(before);
  expect(reads).not.toContain(true);
});

test("opening a note does not reconfigure its editor; a new note on disk does, with no reload", async ({
  page,
  stack,
}) => {
  await start(page, stack.vault);
  await openNote(page, "Plain");
  await expect(page.locator(".cm-content:visible")).toContainText("intro");
  expect(await sameConfig(page)).toBe(true);
  await page.evaluate(() => Object.assign(window, { sameLoad: true }));

  await vaultWith(stack.vault, { "Fresh.md": "new\n" });
  await expect.poll(() => sameConfig(page), { timeout: 15_000 }).toBe(false);
  // The new listing is the one a link completes from.
  await page.locator(".cm-content:visible").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n[[Fresh");
  await expect(page.locator(".cm-tooltip-autocomplete .cm-completionLabel").first()).toHaveText(
    "Fresh",
  );
  expect(await page.evaluate(() => (window as unknown as { sameLoad?: boolean }).sameLoad)).toBe(
    true,
  );
});

const ONTOLOGY = "99 Misc/01 Config/01 Agents/Ontology.md";
const FIRST = "# Ontology\n\n## Relations\n\n- invented-here: only this note says so\n";
const EDITED = "# Ontology\n\n## Relations\n\n- rewritten-since: the note was edited\n";

/** Opens a fresh line below in vim's insert mode and asks for every completion there. */
async function offeredOnNewLine(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+G");
  await page.keyboard.press("o");
  await page.keyboard.press("Control+Space");
}

const labels = (page: Page) => page.locator(".cm-tooltip-autocomplete .cm-completionLabel");

/** Opens Plain with vim on, over a vault whose ontology note lists one relation. */
async function startOntology(page: Page, vault: string): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "on"));
  await vaultWith(vault, { [ONTOLOGY]: FIRST, "Plain.md": "intro\n" });
  await openApp(page);
  await openNote(page, "Plain");
}

test("a line head offers the relation names the vault's ontology note lists, and no other", async ({
  page,
  stack,
}) => {
  await startOntology(page, stack.vault);
  await offeredOnNewLine(page);
  await expect(labels(page)).toHaveText(["invented-here"]);
  // The name narrows as it is typed, as any completion does.
  await page.keyboard.type("inv");
  await expect(labels(page)).toHaveText(["invented-here"]);
});

test("an edit to the ontology note on disk changes what a line head offers, with no reload", async ({
  page,
  stack,
}) => {
  await startOntology(page, stack.vault);
  await offeredOnNewLine(page);
  await expect(labels(page)).toHaveText(["invented-here"]);
  await page.evaluate(() => Object.assign(window, { sameLoad: true }));

  await vaultWith(stack.vault, { [ONTOLOGY]: EDITED });
  // A new line each try: CodeMirror keeps an open list while the prefix still fits it.
  await expect(async () => {
    await offeredOnNewLine(page);
    await expect(labels(page)).toHaveText(["rewritten-since"], { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as { sameLoad?: boolean }).sameLoad)).toBe(
    true,
  );
});

// Blank lines keep each case its own paragraph.
const LINKS = [
  "intro",
  "see [the docs](https://example.com) now",
  "> plain\n> [!note] not a callout",
  "> see [text] here",
  "see [text] here",
  "see [text][ref] here",
  "see [a]() here",
  "> see [the docs](https://example.com) now",
  "see [[borges]] now",
  "[[borges]] and [[ficciones]]",
  "see [[reading/borges#The Aleph|the story]] now",
  "[[01 Periodic/00 Daily/2026-11-09]] | [[reading/borges#The Aleph/2]]",
  "[[reading/borges|]] [[borges|]]",
  "a [[|]] b",
  "a [[/]] b [[/|]] c",
  "see [[reading/borges]] now",
  "see [[#The Aleph]]",
  "see [[borges|Jorge]] and [[cortazar|Julio]]",
  "[[]] and [[ ]]",
  "[[borges and more",
  "[[borges\nand]] more",
  "depends-on:: [[borges]]",
  "see [[borges]] and [[ficciones]]",
  "| a |\n| - |\n| [text] |\n| [b]() |",
  "> see [[borges]] and [[cortazar]]",
  "## see [the docs](https://example.com)",
].join("\n\n");

// The cursor sits on `intro`, so no link is revealed.
const DRAWN = [
  ["intro", "see <L:the docs> now", "plain", "<R:[!note]> not a callout", "see <R:[text]> here"],
  ["see [text] here", "see [text][ref] here", "see <L:a> here", "see <L:the docs> now"],
  ["see <L:borges> now", "<L:borges> and <D:ficciones>", "see <L:the story> now"],
  ["<D:2026-11-09> | <L:borges#The Aleph/2>", "<L:borges> <L:borges>", "a <L:|> b"],
  ["a <D:/> b <D:/|> c", "see <L:borges> now", "see <L:#The Aleph>", "see <L:Jorge> and <D:Julio>"],
  ["[[]] and [[ ]]", "[[borges and more", "[[borges", "and]] more"],
  ["<R:depends-on::> <L:borges>", "see <L:borges> and <D:ficciones>", "[text]", "<L:b>"],
  ["see <L:borges> and <D:cortazar>", "see <L:the docs>"],
].flat();

/** Opens Links with vim `vim`, in a window tall enough that CodeMirror draws every line. */
async function openLinks(page: Page, vault: string, vim: string): Promise<void> {
  await vaultWith(vault, { "Links.md": LINKS, "reading/borges.md": "# The Aleph\n" });
  await page.addInitScript((on) => localStorage.setItem("kasten.vim", on), vim);
  await page.setViewportSize({ width: 1280, height: 2400 });
  await page.goto("/?note=Links.md");
  await expect(page.locator(".cm-content:visible")).toContainText("depends-on");
}

const lineOf = (page: Page, source: string) =>
  page.locator(".cm-content:visible .cm-line").nth(LINKS.split("\n").indexOf(source));

for (const vim of ["on", "off"]) {
  test.describe(`with vim ${vim}`, () => {
    test("a note draws links as their text, keeps a plain [text]'s brackets, mutes a dead link and labels a relation", async ({
      page,
      stack,
    }) => {
      await openLinks(page, stack.vault, vim);
      await expect.poll(() => drawn(page)).toEqual(DRAWN);
    });

    test("the cursor in a link shows that link's source again, and no other link's", async ({
      page,
      stack,
    }) => {
      await openLinks(page, stack.vault, vim);
      const sources = [
        "see [the docs](https://example.com) now",
        "see [[borges]] now",
        "see [[reading/borges]] now",
        "see [[borges|Jorge]] and [[cortazar|Julio]]",
      ];
      const shown = ["", "", "", "see [[borges|Jorge]] and Julio"];
      for (const [n, source] of sources.entries()) {
        const at = LINKS.split("\n").indexOf(source);
        if (vim === "on") {
          await page.keyboard.press("Escape");
          await page.keyboard.type(`${at + 1}G`);
          await page.keyboard.press("w");
          await page.keyboard.press("i");
        } else {
          await page.keyboard.press("Control+Home");
          for (let i = 0; i < at; i++) await page.keyboard.press("ArrowDown");
          for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
        }
        await expect(lineOf(page, source)).toHaveText(shown[n] || source);
        // A poll: on a slow runner the first parse may not have reached the relation's line yet (#2309).
        await expect.poll(() => drawn(page)).toContain("<R:depends-on::> <L:borges>");
      }
    });

    for (const how of ["Control", "Meta", "tap"] as const) {
      test.describe(how === "tap" ? "on a phone" : `by ${how}+click`, () => {
        if (how === "tap") test.use(phone);

        test("#432 follows a link inside bold, italic, strikethrough, highlight, a todo line and an alias", async ({
          page,
          stack,
        }) => {
          await openMarks(page, stack.vault, vim);
          for (const [text, target] of IN_MARKS) {
            await press(page, how, text);
            await expect(page.getByRole("tab", { selected: true })).toContainText(target);
            await page.goto(`/?note=${encodeURIComponent(MARKS_PATH)}`);
            await park(page, how);
          }
        });

        test("#441 #446 #447 #548 opens each address once, unescaped, and no [text] or unsafe one", async ({
          page,
          stack,
        }) => {
          await openMarks(page, stack.vault, vim);
          for (const [text] of ADDRESSES) {
            await press(page, how, text);
            await park(page, how);
          }
          await expect.poll(() => opened(page)).toEqual(ADDRESSES.flatMap(([, url]) => url ?? []));
          expect(await inbox(stack.vault)).toEqual([]);
        });
      });
    }

    test("I1 I4 a plain click on a link in bold or a reference link moves the cursor and opens nothing", async ({
      page,
      stack,
    }) => {
      await openMarks(page, stack.vault, vim);
      await press(page, "click", "bold");
      // Vim's normal mode leaves the link drawn; without vim the line shows its source.
      await expect(caretLine(page)).toHaveText(/^see (\*\*\[\[)?bold(]]\*\*)? now$/);
      await park(page, "click");
      await press(page, "click", "short");
      await park(page, "click");
      await press(page, "Control", "short");
      await expect.poll(() => opened(page)).toEqual(["https://example.com/short"]);
      await expect(page.getByRole("tab", { selected: true })).toContainText("Marks");
    });
  });
}

const ISSUE =
  '- [ ] Decide the scorer rules. **Read [[Scorer Rules]] first: one real example per rule, with a small "Power BI vs AI/BI" table.** **Output:** one answer per line, or "ok" to take every suggestion #internal ⏳ 2026-10-19 ➕ 2026-10-17 ⏲ 20m 🆔 kt-2726c0';
// The text a press lands on, the note it opens, and its line in Marks.
const IN_MARKS = [
  ["Scorer Rules", "Scorer Rules", ISSUE],
  ["bold", "bold", "see **[[bold]]** now"],
  ["italic", "italic", "see *[[italic]]* now"],
  ["struck", "struck", "see ~~[[struck]]~~ now"],
  ["lit", "lit", "see ==[[lit]]== now"],
  ["Jorge", "aliased", "see **[[aliased|Jorge]]** now"],
];
// The text a press lands on and the address it opens, or none.
const ADDRESSES: [string, string?][] = [
  ["mail", "https://example.com/a"],
  ["[plain]"],
  ["[strong]"],
  ["short", "https://example.com/short"],
  ["the full", "https://example.com/full"],
  ["coll", "https://example.com/coll"],
  ["ang", "https://example.com/b"],
  ["inline"],
  ["ref"],
  ["data"],
  ["vb"],
  ["esc", "https://x.y/a)b"],
  ["def", "https://x.y/a>b"],
];
// A shared list, so the todo line stays a line and is not taken into the store as an embed.
const MARKS_PATH = "05 Shared/Marks.md";
// Each link a paragraph of its own under `intro`, where the cursor parks between presses.
const MARKS = [
  "intro",
  ...IN_MARKS.map(([, , line]) => line),
  "see **[mail](https://example.com/a)** now\n\n[plain] here\n\n**[strong]** here",
  "see [short] here\n\nsee [the full][full] here\n\nsee [coll][] here\n\nsee [ang](<https://example.com/b>)",
  "see [inline](javascript:alert(1)) and [ref] and [data] and [vb]\n\nsee [esc](https://x.y/a\\)b) and [def]",
  "[short]: https://example.com/short\n\n[full]: https://example.com/full\n\n[coll]: https://example.com/coll",
  "[ref]: JavaScript:alert(1)\n\n[data]: data:text/html,x\n\n[vb]: vbscript:x\n\n[def]: <https://x.y/a\\>b>",
].join("\n\n");

/** Opens Marks with vim `vim` in a tall window, beside the notes its links name, each window.open recorded. */
async function openMarks(page: Page, vault: string, vim: string): Promise<void> {
  await vaultWith(vault, {
    [MARKS_PATH]: MARKS,
    ...Object.fromEntries(IN_MARKS.map(([, n]) => [`${n}.md`, `at ${n}\n`])),
  });
  await page.addInitScript((on) => localStorage.setItem("kasten.vim", on), vim);
  await recordOpens(page);
  // Tall enough that CodeMirror draws every line, so no press scrolls `intro` away.
  await page.setViewportSize({ width: page.viewportSize()?.width ?? 1280, height: 2400 });
  await page.goto(`/?note=${encodeURIComponent(MARKS_PATH)}`);
  await expect(page.locator(".cm-content:visible")).toContainText("intro", { timeout: 15_000 });
}

/** Presses Marks's drawn text, or a locator, by a tap, a plain click or a click with a modifier. */
async function press(page: Page, how: string, at: string | Locator): Promise<void> {
  const target =
    typeof at === "string"
      ? page.locator(".cm-content:visible").getByText(at, { exact: true })
      : at;
  // A [text] alone at a line's head is the line's own text, which runs the pane's width.
  const spot = at === "[plain]" ? { position: { x: 12, y: 8 } } : {};
  if (how === "tap") await target.tap(spot);
  else await target.click({ ...spot, modifiers: how === "click" ? [] : [how as "Control"] });
}

/** Puts the cursor back on `intro`, so no link shows its source and the next press is no repeat. */
async function park(page: Page, how: string): Promise<void> {
  await press(page, how === "tap" ? how : "click", page.getByText("intro", { exact: true }));
}

test.describe("on a phone", () => {
  test.use(phone);

  test("I2 I5 a tap on a link the cursor sits in, in bold or a reference link, follows nothing", async ({
    page,
    stack,
  }) => {
    await openMarks(page, stack.vault, "on");
    await press(page, "tap", "short");
    await park(page, "tap");
    for (const text of ["bold", "short"]) {
      await page.keyboard.type(`/${text}`);
      await page.keyboard.press("Enter");
      await expect(caretLine(page)).toContainText(`see ${text}`);
      await press(page, "tap", caretLine(page).getByText(text).last());
    }
    await expect(page.getByRole("tab", { selected: true })).toContainText("Marks");
    expect(await opened(page)).toEqual(["https://example.com/short"]);
  });

  test("#618 a tap follows a link in italic once a starved first parse catches up", async ({
    page,
    stack,
  }) => {
    // A clock that leaps a second each read spends the first parse's budget at once, as a loaded
    // machine can; it runs true once the editor is in the page, so the idle parse has its time.
    await page.addInitScript(() => {
      const real = Date.now;
      let now = real();
      Date.now = () => (now += 1000);
      const done = () => document.querySelector(".cm-content") && (Date.now = real);
      new MutationObserver((_, watch) => done() && watch.disconnect()).observe(document, {
        childList: true,
        subtree: true,
      });
    });
    await openMarks(page, stack.vault, "off");
    await press(page, "tap", "italic");
    await expect(page.getByRole("tab", { selected: true })).toContainText("italic");
  });

  test("#2116 a link in a quote draws in the link colour, a markdown link and a wikilink alike", async ({
    page,
    stack,
  }) => {
    const quoted = "intro\n\n> see [the docs](https://example.com) and [[borges]]\n";
    await vaultWith(stack.vault, { "Quoted.md": quoted, "reading/borges.md": "# The Aleph\n" });
    await page.goto("/?note=Quoted.md");
    await expect.poll(() => drawn(page)).toEqual(["intro", "see <L:the docs> and <L:borges>"]);
  });
});

test("a link reads as dead only once the vault's listing lands, and comes alive when its note arrives", async ({
  page,
  stack,
}) => {
  const listed = await hold(page, /\/api\/files$/);
  await openLinks(page, stack.vault, "on");
  await expect.poll(() => drawn(page)).toContain("see <L:borges> and <L:ficciones>");
  expect((await drawn(page)).filter((text) => text.includes("<D:"))).toEqual([]);

  await listed();
  await expect.poll(() => drawn(page)).toContain("see <L:borges> and <D:ficciones>");
  await vaultWith(stack.vault, { "ficciones.md": "stories\n" });
  await expect
    .poll(() => drawn(page), { timeout: 15_000 })
    .toContain("see <L:borges> and <L:ficciones>");
});
