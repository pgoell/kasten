import type { Page } from "@playwright/test";
import { openApp, openNote, vaultWith } from "../../../harness/app.ts";
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

test.beforeEach(async ({ page, stack }) => {
  await vaultWith(stack.vault, { "Plain.md": "intro\n" });
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await watchEditors(page);
  await openApp(page);
});

test("a note's editor reads the fonts while its view is still off the page", async ({ page }) => {
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
