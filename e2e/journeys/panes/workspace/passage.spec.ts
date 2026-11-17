import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { leader, noteText, panes, vaultWith } from "../../../harness/app.ts";
import { root } from "../../../harness/paths.ts";
import { expect, test } from "../../../harness/stack.ts";

const NOTE = "04 Books/Contents.md";
const EPUB = join(root, "frontend/tests/fixtures/contents.epub");
// Chapter Two's first line in contents.epub, and in no other chapter.
const PASSAGE = "Chapter Two of the fixture, with words to click on.";
const HELD = `> ${PASSAGE}\n\nSection 2 ^hl-a3f9c1\n`;

// Wide enough that the reader's half of the split draws its contents, whose marked row names the chapter on screen.
test.use({ viewport: { width: 3000, height: 900 } });

const reader = (page: Page) => page.locator("[data-book-pane]");
const marked = (page: Page) =>
  reader(page).locator('nav[aria-label="Book contents"] [aria-current="true"]');

/** The highlight's note beside the contents epub, open with vim in normal mode on its quote line. */
async function opened(page: Page, vault: string) {
  await vaultWith(vault, { [NOTE]: HELD });
  await copyFile(EPUB, join(vault, "04 Books/Contents.epub"));
  await page.goto(`/?note=${encodeURIComponent(NOTE)}`);
  await page.locator(".cm-line", { hasText: "Section 2" }).click({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await page.keyboard.type("gg");
}

/** `<leader>gr` opens the reader at its bookmark, the first chapter; `<leader>o` takes the focus back to the note. */
async function readerOpen(page: Page) {
  await leader(page, "gr");
  await expect(marked(page)).toHaveText(["One"], { timeout: 15_000 });
  await leader(page, "o");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

test("gf on a highlight's quote line splits a reader beside the note and takes it to the passage", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await page.keyboard.type("gf");
  await expect(panes(page)).toHaveCount(2);
  await expect(marked(page)).toHaveText(["Two"], { timeout: 15_000 });
});

test("gf with the book's reader open moves to it, makes no second, and takes it to the passage", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await readerOpen(page);
  await page.keyboard.type("gggf");
  await expect(marked(page)).toHaveText(["Two"], { timeout: 15_000 });
  await expect(reader(page)).toBeFocused();
  await expect(panes(page)).toHaveCount(2);
  await expect(reader(page)).toHaveCount(1);
});

test("the passage is handed over once: the reader opened again later opens at its bookmark", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await page.keyboard.type("gf");
  await expect(marked(page)).toHaveText(["Two"], { timeout: 15_000 });
  // Away from the passage, so the bookmark the close writes is not the passage too.
  await reader(page)
    .getByRole("navigation", { name: "Book contents" })
    .getByRole("button", { name: "One", exact: true })
    .click();
  await expect(marked(page)).toHaveText(["One"]);
  await reader(page).focus();
  await page.keyboard.press("q");
  await expect(reader(page)).toHaveCount(0);
  await expect.poll(() => noteText(stack.vault, NOTE), { timeout: 15_000 }).toMatch(/^reading: /m);

  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await leader(page, "gr");
  await expect(marked(page)).toHaveText(["One"], { timeout: 15_000 });
  // A stale passage would land after the bookmark, so give it the time to.
  await page.waitForTimeout(1_000);
  await expect(marked(page)).toHaveText(["One"]);
});

test("gf while the note stands conflicted moves neither the focus nor the open reader", async ({
  page,
  stack,
}) => {
  await opened(page, stack.vault);
  await readerOpen(page);
  // The typing's write waits while somebody else writes the file in place, then the vault refuses it over its base.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let typed = false;
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${NOTE}`,
    async (route) => {
      const put = route.request().method() === "PUT";
      if (put && route.request().postDataJSON().content.includes("typed here")) {
        typed = true;
        await held;
      }
      await route.fallback();
    },
  );
  await page.keyboard.type("Gotyped here");
  await page.keyboard.press("Escape");
  await expect.poll(() => typed).toBe(true);
  const path = join(stack.vault, NOTE);
  await writeFile(path, `${await readFile(path, "utf8")}Somebody else wrote this.\n`);
  release();
  await expect(page.getByTestId("save-status")).toHaveAttribute("aria-label", "Changed on disk", {
    timeout: 15_000,
  });

  await page.keyboard.type("gggf");
  // A seek armed for the refused press would take the open reader to the passage.
  await page.waitForTimeout(1_000);
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  await expect(marked(page)).toHaveText(["One"]);
});

test("gf clears the notice in the bar, as every other key does", async ({ page, stack }) => {
  await opened(page, stack.vault);
  const chooser = page.waitForEvent("filechooser");
  await leader(page, "cb");
  // No book has that suffix, so the upload stops before it starts and the bar says so.
  await (await chooser).setFiles({
    name: "a.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(""),
  });
  const notice = page.getByTestId("notice");
  await expect(notice).toHaveText("The vault will not take that name");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  // The cursor is still on the quote line, so gf is the only press.
  await page.keyboard.type("gf");
  await expect(marked(page)).toHaveText(["Two"], { timeout: 15_000 });
  await expect(notice).toHaveCount(0);
});
