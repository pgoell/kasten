import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import { leader, noteText, openApp, openFromTree, phone, readAll } from "../../harness/app.ts";
import { root } from "../../harness/paths.ts";
import { expect, test } from "../../harness/stack.ts";

const epub = join(root, "frontend/tests/fixtures/contents.epub");
const book = "04 Books/Contents.md";
// The start of the second chapter, "Two", which the header names once the reader is there.
const place = "epubcfi(/6/4!/4/2/1:0)";

/**
 * Puts a real epub beside each note, the note keeping a reading place, then loads the app and
 * waits for its asset listing, so the book finder opens on the shelf and not on its loading list.
 */
async function openOnShelf(
  page: Page,
  vault: string,
  notes = [book],
  load = openApp,
): Promise<void> {
  for (const note of notes) {
    await mkdir(join(vault, dirname(note)), { recursive: true });
    await writeFile(join(vault, note), `---\nreading: ${place}\n---\n# A book\n`);
    await copyFile(epub, join(vault, note.replace(/\.md$/, ".epub")));
  }
  const listed = page.waitForResponse((response) => response.url().endsWith("/api/vault-assets"));
  await load(page);
  await listed;
}

/** Loads the app on a phone, which shows the command row and no tree. */
async function openPhone(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("toolbar", { name: "Commands" })).toBeVisible({ timeout: 15_000 });
}

/** The note of each book the page fetches, so a journey can say which book the reader read. */
function booksRead(page: Page): string[] {
  const read: string[] = [];
  page.on("request", (request) => {
    const url = decodeURIComponent(request.url());
    if (url.includes("/api/books/")) read.push(url.replace(/^.*\/api\/books\//, ""));
  });
  return read;
}

/** Opens Welcome and appends to its last line in vim, so the note is unsaved. */
async function editWelcome(page: Page): Promise<void> {
  await openFromTree(page, "Welcome");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("GA, edited");
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-content")).toContainText("Long note., edited");
}

/** Opens the book finder with its first row on the book, and takes it with Enter. */
async function pickBook(page: Page): Promise<void> {
  await leader(page, "fb");
  const finder = page.getByRole("dialog", { name: "Find book" });
  await expect(finder.getByRole("option", { selected: true })).toContainText("Contents");
  await page.keyboard.press("Enter");
  await expect(finder).toBeHidden();
}

const header = (page: Page) => page.locator("[data-book-pane] header");

test("Space f b and Enter write the edited note, then open the book alone in its pane at its place", async ({
  page,
  stack,
}) => {
  const read = booksRead(page);
  await openOnShelf(page, stack.vault);
  await editWelcome(page);

  await pickBook(page);

  await expect(header(page)).toContainText("Two", { timeout: 15_000 });
  await expect(page.locator("[data-pane]")).toHaveCount(1);
  await expect(page.locator(".cm-content")).toHaveCount(0);
  expect(read).toEqual([book]);
  await expect.poll(() => noteText(stack.vault, "Welcome.md")).toContain(", edited");
});

test("the book's header and footer read where the reader is, and The book's note opens the note beside", async ({
  page,
  stack,
}) => {
  await openOnShelf(page, stack.vault);
  await pickBook(page);
  const pane = page.locator("[data-book-pane]");
  await expect(header(page)).toContainText("Two", { timeout: 15_000 });

  // In one read, so a relocate cannot land between the header and the footer.
  const read = await pane.evaluate((root) => {
    const title = root.querySelector('header [title="04 Books/Contents.md"]') as HTMLElement;
    const badge = root.querySelector("header span") as HTMLElement;
    return {
      header: root.querySelector("header")?.textContent,
      footer: root.querySelector("footer")?.textContent,
      mono: getComputedStyle(title).fontFamily !== getComputedStyle(badge).fontFamily,
      monoFirst: getComputedStyle(title).fontFamily.split(",")[0],
    };
  });
  const [, percent] = read.header?.match(/^BOOKContentsTwo(\d+)%The book's note$/) ?? [];
  expect(percent, `header read ${read.header}`).toBeDefined();
  expect(read.footer).toBe(`Two${percent}% of the book`);
  // The title wears the theme's mono face, not the sans of the BOOK badge beside it.
  expect(read.mono, `title font ${read.monoFirst}`).toBe(true);
  expect(read.monoFirst).toMatch(/mono/i);

  await pane.getByRole("button", { name: "The book's note" }).click();
  const note = page.locator(".cm-editor", { hasText: "A book" });
  await expect(note).toBeVisible();
  await expect(pane).toBeVisible();
  const [bookBox, noteBox] = await Promise.all([pane.boundingBox(), note.boundingBox()]);
  expect(noteBox?.x ?? 0).toBeGreaterThanOrEqual((bookBox?.x ?? 0) + (bookBox?.width ?? 0) - 1);
});

test("a failed write keeps the edited note in its pane with the focus, and opens no book", async ({
  page,
  stack,
}) => {
  await openOnShelf(page, stack.vault);
  await page.route("**/api/files/Welcome.md", (route) =>
    route.request().method() === "PUT" ? route.fulfill({ status: 500 }) : route.fallback(),
  );
  await editWelcome(page);

  await pickBook(page);

  await expect(page.locator(".cm-content:focus")).toContainText("Long note., edited");
  await expect(page.locator("[data-book-pane]")).toHaveCount(0);
  expect(await noteText(stack.vault, "Welcome.md")).not.toContain("edited");
});

test("the book fills the pane it was picked from when the focus moves right during the write (#1626)", async ({
  page,
  stack,
}) => {
  await openOnShelf(page, stack.vault);
  let answer = () => {};
  const held = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route("**/api/files/Welcome.md", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await held;
    await route.fallback();
  });
  const panes = page.locator("[data-pane]");
  // Each wait on the focus: keys sent before an editor holds it are lost (#1615).
  await openFromTree(page, "Welcome");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  await leader(page, "%");
  await openFromTree(page, "Long note");
  await expect(panes.nth(1).locator(".cm-content:focus")).toHaveCount(1);
  await leader(page, "h");
  await expect(panes.nth(0).locator(".cm-content:focus")).toContainText("Welcome");
  await page.keyboard.type("GA, edited");
  await page.keyboard.press("Escape");

  await pickBook(page);
  // The finder hands no focus back once a row is taken, so a click moves it.
  await panes.nth(1).locator(".cm-content").click();
  await expect(panes.nth(1).locator(".cm-content:focus")).toHaveCount(1);
  answer();

  await expect(panes.nth(0).locator("[data-book-pane]")).toBeVisible({ timeout: 15_000 });
  await expect(panes.nth(1).locator("[data-pane-header]")).toContainText("Long note.md");
  await expect(panes.nth(1).locator(".cm-content:focus")).toHaveCount(1);
  await expect.poll(() => noteText(stack.vault, "Welcome.md")).toContain(", edited");
});

test("Enter on a book a reader already shows moves to that reader rather than open a second", async ({
  page,
  stack,
}) => {
  await openOnShelf(page, stack.vault);
  await page.goto(`/?note=${encodeURIComponent(book)}`);
  await expect(page.locator(".cm-content:focus")).toHaveCount(1, { timeout: 15_000 });
  await leader(page, "gr");
  await expect(header(page)).toContainText("Two", { timeout: 15_000 });
  await leader(page, "h");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);

  await pickBook(page);

  await expect(page.locator("[data-pane]")).toHaveCount(2);
  await expect(page.locator("[data-book-pane]")).toHaveCount(1);
  await expect(page.locator("[data-book-pane]:focus")).toHaveCount(1);
});

test("an archived book stays off the list until Space a shows the archive", async ({
  page,
  stack,
}) => {
  await openOnShelf(page, stack.vault, [book, "98 Archive/Old Book.md"]);
  await leader(page, "fb");
  const finder = page.getByRole("dialog", { name: "Find book" });
  const names = finder.getByRole("option").locator("span:first-child");
  await expect(names).toHaveText(["Contents"]);
  await page.keyboard.press("Escape");

  await leader(page, "a");
  await leader(page, "fb");

  await expect
    .poll(async () =>
      (
        await readAll(page, '[role="dialog"][aria-label="Find book"] [role="option"]', (all) =>
          all.map((row) => row.children[0]?.textContent ?? ""),
        )
      ).sort(),
    )
    .toEqual(["Contents", "Old Book"]);
});

test.describe("with vim off", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  });

  test("the palette's Find a book opens the finder, and Enter opens the book", async ({
    page,
    stack,
  }) => {
    await openOnShelf(page, stack.vault);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Find a book/ }).click();
    const finder = page.getByRole("dialog", { name: "Find book" });
    await expect(finder.getByRole("option", { selected: true })).toContainText("Contents");

    await page.keyboard.press("Enter");

    await expect(header(page)).toContainText("Two", { timeout: 15_000 });
    await expect(page.locator("[data-pane]")).toHaveCount(1);
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a tap on run, Find a book and the book opens it alone in the one pane", async ({
    page,
    stack,
  }) => {
    const read = booksRead(page);
    await openOnShelf(page, stack.vault, [book], openPhone);
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Find a book/ }).tap();
    await page.getByRole("option", { name: /^Contents/ }).tap();

    await expect(header(page)).toContainText("Contents", { timeout: 15_000 });
    await expect(page.locator("[data-pane]")).toHaveCount(1);
    await expect(page.locator(".cm-content")).toHaveCount(0);
    expect(read).toEqual([book]);
  });
});

test("the outgoing links panel lists the note's links, opens one, and says when there are none", async ({
  page,
}) => {
  await openApp(page);
  await openFromTree(page, "Welcome");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  await leader(page, "go");
  const panel = page.getByRole("dialog", { name: "Outgoing links" });
  await expect(panel.getByLabel("links out")).toBeFocused();
  await expect
    .poll(() =>
      readAll(page, '[role="dialog"][aria-label="Outgoing links"] [role="option"]', (rows) =>
        rows.map((row) => row.getAttribute("data-path")),
      ),
    )
    .toEqual(["02 Projects/Garden.md", "Long note.md"]);
  await page.keyboard.type("gar");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  // Keys sent before the editor holds the focus are lost (#1615).
  await expect(page.locator(".cm-content:focus")).toContainText("Work for the spring beds");

  await leader(page, "go");
  await expect(panel.getByRole("status")).toHaveText("this note links nowhere");
  await expect(panel.getByRole("option")).toHaveCount(0);
});
