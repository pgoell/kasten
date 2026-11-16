import type { Page } from "@playwright/test";
import { drawn, hold, openApp, openNote, phone, vaultWith } from "../../../harness/app.ts";
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
        expect(await drawn(page)).toContain("<R:depends-on::> <L:borges>");
      }
    });
  });
}

test.describe("on a phone", () => {
  test.use(phone);

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
