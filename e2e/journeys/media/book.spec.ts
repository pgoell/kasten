import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  findNote,
  leader,
  noteText,
  openApp,
  phone,
  tapHeight,
  vaultWith,
} from "../../harness/app.ts";
import { root } from "../../harness/paths.ts";
import { expect, test } from "../../harness/stack.ts";

const primer = "04 Books/Primer.md";

test("the book pane reopens a pdf at the page it was left on", async ({ page, stack }) => {
  await openApp(page);
  await findNote(page, "Primer");

  // pdf.js draws the pages on a canvas, so no page text reaches the DOM. The header
  // shows the page as a share of the 8 pages: page N reads N/8.
  await leader(page, "gr");
  const pane = page.locator("[data-book-pane]");
  await expect(pane.getByText("13%", { exact: true })).toBeVisible();
  for (const percent of ["25%", "38%", "50%"]) {
    await page.keyboard.press("l");
    await expect(pane.getByText(percent, { exact: true })).toBeVisible();
  }

  // Closing the reader writes the place into the note's frontmatter, and the note beside takes
  // the focus, so the next leader key needs no click first (#1605).
  await page.keyboard.press("q");
  await expect(pane).toHaveCount(0);
  await expect
    .poll(() => noteText(stack.vault, primer), { timeout: 15_000 })
    .toMatch(/^reading: epubcfi\(/m);

  await leader(page, "gr");
  await expect(page.locator("[data-book-pane]").getByText("50%", { exact: true })).toBeVisible();
});

test("Escape in the tree hands the keys back to the book pane", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Primer");
  await leader(page, "gr");
  const pane = page.locator("[data-book-pane]");
  await expect(pane.getByText("13%", { exact: true })).toBeVisible();
  await leader(page, "e");
  const tree = page.getByRole("navigation", { name: "Vault" });
  await expect(tree.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(tree).toBeVisible();
  await page.keyboard.press("l");
  await expect(pane.getByText("25%", { exact: true })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("closing the book from the palette shows its note again", async ({ page }) => {
    await page.goto(`/?note=${encodeURIComponent(primer)}`);
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    const run = async (name: RegExp) => {
      await commands.getByRole("button", { name: "Run a command by name" }).tap();
      await page.getByRole("option", { name }).first().tap();
    };
    await expect(page.getByText("Notes on the primer")).toBeVisible();

    await run(/Read this note's book beside it/);
    await expect(page.locator("[data-book-pane]")).toBeVisible();
    await run(/Close the note, then the pane/);

    // The pane goes with the book, so no empty pane showing Today stacks under the note.
    await expect(page.locator("[data-book-pane]")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toHaveCount(1);
    await expect(page.getByText("Notes on the primer")).toBeVisible();
  });

  test("a take's toast sits over the text column, above the footer", async ({ page, stack }) => {
    const pane = await openContents(page, stack.vault);
    const words = "Chapter One";
    await select(page, words);
    const take = pane.locator("footer").getByRole("button", { name: "Take" });
    expect(await tapHeight(take)).toBeGreaterThanOrEqual(44);
    await take.tap();

    // Read in one go, since the toast fades after a few seconds and a phone has no hover to hold it.
    const placed = await pane.evaluate(async (root) => {
      while (!root.querySelector("[role=status]")) await new Promise(requestAnimationFrame);
      const toast = root.querySelector("[role=status]") as HTMLElement;
      const footer = root.querySelector("footer") as HTMLElement;
      const column = toast.parentElement as HTMLElement;
      const [t, f, c] = [toast, footer, column].map((el) => el.getBoundingClientRect());
      return {
        said: toast.textContent,
        overText: column.querySelector("foliate-view") !== null,
        inFooter: footer.contains(toast),
        aboveFooter: t.bottom <= f.top,
        inColumn: t.left >= c.left && t.right <= c.right && t.top >= c.top,
      };
    });
    expect(placed).toEqual({
      said: expect.stringContaining("Taken into the book's note"),
      overText: true,
      inFooter: false,
      aboveFooter: true,
      inColumn: true,
    });
    await expect.poll(() => noteText(stack.vault, book), { timeout: 15_000 }).toContain(words);
  });
});

test.describe("on a wide touch screen", () => {
  // Wide enough that the book's half of the split draws both side columns.
  test.use({ viewport: { width: 3000, height: 900 }, hasTouch: true, isMobile: true });

  test("the contents and Taken rows are 44 px and Tab stops", async ({ page, stack }) => {
    const pane = await openContents(page, stack.vault, true);
    // A short passage, so a Taken row with no 44 px floor is one line and shorter than that.
    await select(page, "Chapter One");
    await pane.locator("footer").getByRole("button", { name: "Take" }).tap();
    const contents = pane.getByRole("navigation", { name: "Book contents" }).getByRole("button");
    const taken = pane.getByRole("region", { name: "Taken" }).getByRole("button");
    // The epub's three chapters (One, Two and Deeper under Two) and the one passage.
    await expect(contents).toHaveText(["One", "Two", "Deeper"]);
    await expect(taken).toHaveText(["Chapter One"], { timeout: 15_000 });

    for (const row of [...(await contents.all()), ...(await taken.all())]) {
      expect(await tapHeight(row)).toBeGreaterThanOrEqual(44);
      expect(await row.evaluate((el) => (el as HTMLElement).tabIndex)).toBeGreaterThanOrEqual(0);
    }
    // A real Tab walks the contents row by row.
    await contents.first().focus();
    for (const at of [1, 2]) {
      await page.keyboard.press("Tab");
      await expect(contents.nth(at)).toBeFocused();
    }
  });
});

const book = "04 Books/Contents.md";

/** The contents epub beside its note, opened from the command palette by taps; returns the pane. */
async function openContents(page: Page, vault: string, wide = false): Promise<Locator> {
  await vaultWith(vault, { [book]: "# A book\n" });
  await copyFile(
    join(root, "frontend/tests/fixtures/contents.epub"),
    join(vault, "04 Books/Contents.epub"),
  );
  await page.goto(`/?note=${encodeURIComponent(book)}`);
  if (wide) {
    // A wide screen draws no toolbar; the palette's chord works with vim off.
    await page.locator(".cm-line", { hasText: "A book" }).tap({ timeout: 15_000 });
    await page.keyboard.press("Control+Shift+P");
  } else {
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
  }
  await page
    .getByRole("option", { name: /Read this note's book beside it/ })
    .first()
    .tap();
  const pane = page.locator("[data-book-pane]");
  await expect(pane.locator("header")).toContainText("%", { timeout: 15_000 });
  return pane;
}

/** Selects `words` in the book's section: foliate's shadow roots are closed, but the section is a frame of the page. */
async function select(page: Page, words: string) {
  let selected = false;
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        selected ||= await frame
          .evaluate((wanted) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const at = node.textContent?.indexOf(wanted) ?? -1;
              if (at < 0) continue;
              const range = document.createRange();
              range.setStart(node, at);
              range.setEnd(node, at + wanted.length);
              getSelection()?.removeAllRanges();
              getSelection()?.addRange(range);
              return true;
            }
            return false;
          }, words)
          .catch(() => false);
      }
      return selected;
    })
    .toBe(true);
}
