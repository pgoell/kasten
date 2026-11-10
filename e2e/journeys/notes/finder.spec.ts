import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import { findNote, leader, openApp, phone } from "../../harness/app.ts";
import { root } from "../../harness/paths.ts";
import { expect, test } from "../../harness/stack.ts";

const EPUB = join(root, "frontend/tests/fixtures/contents.epub");

test("the finder opens the note it finds", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Garden");
  await expect(page.locator(".cm-content")).toContainText("water the tomatoes");
});

test("a query the finder reads into nothing says so, and Enter opens nothing", async ({ page }) => {
  await openApp(page);
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await expect(finder.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("zzz");
  await expect(finder.getByRole("status")).toHaveText("no notes match");
  await expect(finder.getByRole("option")).toHaveCount(0);
  // An empty list is where Tab would leave the panel and never come back.
  await page.keyboard.press("Tab");
  await expect(finder.getByRole("combobox")).toBeFocused();
  const tabs = await page.getByRole("tab").count();
  await page.keyboard.press("Enter");
  await expect(finder).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(tabs);
});

test("the finder's keys walk the list, and Enter opens the row the highlight is on", async ({
  page,
}) => {
  await openApp(page);
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  const input = finder.getByRole("combobox");
  const options = finder.getByRole("option");
  const selected = finder.getByRole("option", { selected: true });
  await expect(options.nth(2)).toBeVisible();
  // Read, not assumed: the walk holds whatever order the vault ranks in.
  const names = await options.allTextContents();
  const paths = await options.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-path")),
  );
  const walk: [string, number][] = [
    ["ArrowDown", 1],
    ["Control+n", 2],
    ["ArrowUp", 1],
    ["Control+p", 0],
    ["Control+j", 1],
    ["Control+k", 0],
    ["Control+k", 0],
    ["Tab", 1],
    ["Tab", 2],
    ["Shift+Tab", 1],
  ];
  for (const [key, row] of walk) {
    await page.keyboard.press(key);
    await expect(selected, key).toHaveText(names[row]);
  }
  await expect(input).toBeFocused();

  await page.keyboard.type("o");
  await expect(options.nth(1)).toBeVisible();
  await expect(selected).toHaveText((await options.first().textContent()) ?? "");
  await input.fill("");
  await expect(selected).toHaveText(names[0]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const name = (paths[1] ?? "").replace(/^.*\//, "").replace(/\.md$/, "");
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
});

test("the finder's Enter opens the row it ranks first, not the text typed", async ({ page }) => {
  await openApp(page);
  await leader(page, "ff");
  // `grdn` names no note; `02 Projects/Garden.md` reads into it.
  await page.keyboard.type("grdn");
  await expect(page.getByRole("option", { selected: true })).toHaveText("Garden 02 Projects");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
});

test("the finder lists a pdf beside its note as its own row, and its preview names the pane", async ({
  page,
}) => {
  // Every file the finder fetches: a pdf read as a note would show here.
  const read: string[] = [];
  page.on("request", (request) => {
    const url = decodeURIComponent(request.url());
    if (url.includes("/api/files/")) read.push(url);
  });
  // A fake clock that still runs, so the preview's delay can be run out on demand.
  await page.clock.install();
  await openApp(page);
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await page.keyboard.type("primer");
  const note = finder.locator('[data-path="04 Books/Primer.md"]');
  const pdf = finder.getByRole("option", { name: /Primer\.pdf/ });
  await expect(note).toHaveText("Primer 04 Books");
  await expect(pdf).toHaveText(/^04 Books\/Primer\.pdf\s*PDF$/);
  await expect(finder.getByRole("option")).toHaveCount(2);

  await page.keyboard.type(".pdf");
  await expect(pdf).toHaveAttribute("aria-selected", "true");
  await expect(finder.getByTestId("preview")).toHaveText("pdf, opens in the pdf pane");
  // Past the delay a note row waits before its read, so a read of the pdf has begun.
  await page.clock.runFor(1_000);
  await expect(finder.getByTestId("preview")).toHaveText("pdf, opens in the pdf pane");
  expect(read.filter((url) => url.endsWith("Primer.pdf"))).toEqual([]);
});

test("the finder previews the highlighted note as the editor draws it, and reads it once", async ({
  page,
}) => {
  const read: string[] = [];
  page.on("request", (request) => {
    const url = decodeURIComponent(request.url());
    if (url.includes("/api/files/")) read.push(url);
  });
  await openApp(page);
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await page.keyboard.type("grdn");
  await expect(finder.getByRole("option", { selected: true })).toHaveText("Garden 02 Projects");
  const preview = finder.getByTestId("preview");
  await expect(preview).toContainText("water the tomatoes");
  // `# Garden` drawn as a heading, its mark hidden as the editor hides it.
  await expect(preview).toContainText("Garden");
  await expect(preview).not.toContainText("#");
  expect(read.filter((url) => url.endsWith("Garden.md"))).toHaveLength(1);
});

test("Escape closes the finder and opens nothing", async ({ page }) => {
  await openApp(page);
  const tabs = await page.getByRole("tab").count();
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await expect(finder.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(finder).toBeHidden();
  await expect(page.getByRole("tab")).toHaveCount(tabs);
});

test("a content search opens the note on the line it matches", async ({ page }) => {
  await openApp(page);
  await leader(page, "fg");
  await page.keyboard.type("far away letter");
  await expect(page.getByRole("option", { name: /far away letter/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Long note", selected: true })).toBeVisible();
  const line = page.locator(".cm-line", {
    hasText: "reply to the far away letter",
  });
  await expect(line).toBeInViewport();
  await expect(page.locator(".cm-activeLine")).toContainText("reply to the far away letter");
});

/**
 * Writes each file into the test's vault, then loads the app and waits for its asset listing,
 * so the book finder opens on the shelf and not on the empty list it shows while that loads.
 */
async function openOnShelf(page: Page, vault: string, files: string[]): Promise<void> {
  await Promise.all(files.map((file) => writeFile(join(vault, file), "not a real epub")));
  const listed = page.waitForResponse((response) => response.url().endsWith("/api/vault-assets"));
  await openApp(page);
  await listed;
}

test("the book finder lists the notes with an epub beside them and walks them with its keys", async ({
  page,
  stack,
}) => {
  const read: string[] = [];
  page.on("request", (request) => {
    const url = decodeURIComponent(request.url());
    if (url.includes("/api/files/")) read.push(url);
  });
  // A fake clock that still runs, so the preview's delay can be run out on demand.
  await page.clock.install();
  // Primer has a pdf beside it, Quote an epub spelt in capitals, and Orphan no note at all.
  await openOnShelf(page, stack.vault, [
    "02 Projects/Garden.epub",
    "02 Projects/Home.epub",
    "Long note.epub",
    "01 Notes/Quote.EPUB",
    "Orphan.epub",
  ]);
  const tabs = await page.getByRole("tab").count();
  await leader(page, "fb");
  const finder = page.getByRole("dialog", { name: "Find book" });
  const input = finder.getByLabel("find book");
  await expect(input).toBeFocused();
  const options = finder.getByRole("option");
  // Each row as its name and its folder; the root's book has none.
  const rows = () =>
    options.evaluateAll((all) =>
      all.map((row) => [...row.children].map((part) => part.textContent)),
    );
  await expect
    .poll(async () => (await rows()).sort())
    .toEqual([
      ["Garden", "02 Projects"],
      ["Home", "02 Projects"],
      ["Long note", ""],
    ]);

  // Read, not assumed: the walk holds whatever order the finder ranks in.
  const names = (await rows()).map(([name]) => name);
  const selected = finder.getByRole("option", { selected: true }).locator("span").first();
  const walk: [string, number][] = [
    ["Control+j", 1],
    ["Control+k", 0],
    ["ArrowUp", 0],
    ["ArrowDown", 1],
    ["ArrowDown", 2],
    ["ArrowDown", 2],
    ["ArrowUp", 1],
  ];
  for (const [key, row] of walk) {
    await page.keyboard.press(key);
    await expect(selected, key).toHaveText(names[row] ?? "");
  }
  // Past the delay the note finder waits before it reads, with a row highlighted.
  await page.clock.runFor(1_000);
  await expect(finder.getByTestId("preview")).toHaveCount(0);
  expect(read.filter((url) => /\/(Garden|Home|Long note)\.md$/.test(url))).toEqual([]);

  // All three read into `e`, so a highlight left on the second row would stay there.
  await page.keyboard.type("e");
  await expect
    .poll(async () => [await selected.textContent(), (await rows())[0]?.[0]])
    .toEqual([names[0], names[0]]);
  await input.fill("gar");
  await expect.poll(rows).toEqual([["Garden", "02 Projects"]]);
  // A bare j or k is a letter of a name, not a move.
  await input.fill("");
  await page.keyboard.type("jk");
  await expect(input).toHaveValue("jk");
  await expect(finder.getByRole("status")).toHaveText("no books match");
  await expect(options).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(finder).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(tabs);

  await page.keyboard.press("Escape");
  await expect(finder).toBeHidden();
  await expect(page.getByRole("tab")).toHaveCount(tabs);
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);

  // A click beside the panel closes it too.
  await leader(page, "fb");
  const panel = await finder.locator("> div").boundingBox();
  await page.mouse.click((panel?.x ?? 0) / 2, (panel?.y ?? 0) + 10);
  await expect(finder).toBeHidden();
  await expect(page.getByRole("tab")).toHaveCount(tabs);
});

test("the book finder says the vault has no books, and Enter opens nothing", async ({
  page,
  stack,
}) => {
  // Quote.md's book would be `Quote.epub` spelt so, and Orphan.epub has no note.
  await openOnShelf(page, stack.vault, ["01 Notes/Quote.EPUB", "Orphan.epub"]);
  const tabs = await page.getByRole("tab").count();
  await leader(page, "fb");
  const finder = page.getByRole("dialog", { name: "Find book" });
  await expect(finder.getByRole("status")).toHaveText("the vault has no books");
  await expect(finder.getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(finder).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(tabs);
});

test.describe("opening a file from the finder", () => {
  const PRIMER = "04 Books/Primer.pdf";
  const pdfPane = (page: Page, path: string) => page.locator(`[data-pdf-pane="${path}"]`);

  /** Copies each file from its source, in the vault or absolute; records each window.open; loads the app. */
  async function vaultWith(page: Page, vault: string, files: Record<string, string>) {
    for (const [path, from] of Object.entries(files)) {
      await mkdir(join(vault, dirname(path)), { recursive: true });
      await copyFile(from.startsWith("/") ? from : join(vault, from), join(vault, path));
    }
    // A new tab would leave the box, so the page keeps the addresses it was asked to open.
    await page.addInitScript(() => {
      const opened: string[] = [];
      Object.assign(window, { opened, open: (url: string) => opened.push(url) && null });
    });
    await openApp(page);
  }

  /** Opens the finder with Space f f, waits for its input's focus, and types `query`. */
  async function find(page: Page, query: string) {
    await leader(page, "ff");
    const input = page.getByRole("dialog", { name: "Find note" }).getByRole("combobox");
    await expect(input).toBeFocused();
    await input.fill(query);
  }

  const selected = (page: Page) => page.getByRole("option", { selected: true });

  test("Enter on a pdf row opens it at page 1 in place of the editor, its suffix in any case", async ({
    page,
    stack,
  }) => {
    await vaultWith(page, stack.vault, { "x/Plan.PDF": PRIMER });
    await find(page, "Primer.pdf");
    await expect(selected(page)).toContainText(PRIMER);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Find note" })).toBeHidden();
    await expect(pdfPane(page, PRIMER)).toBeVisible();
    expect([
      await pdfPane(page, PRIMER).getAttribute("data-page"),
      await page.locator(".cm-content").count(),
    ]).toEqual([null, 0]);

    await find(page, "x/plan.pdf");
    await expect(selected(page)).toHaveText(/^x\/Plan\.PDF\s*PDF$/);
    await page.keyboard.press("Enter");
    await expect(pdfPane(page, "x/Plan.PDF")).toBeVisible();
  });

  test("a tap on an html row opens the html pane", async ({ page, stack }) => {
    await vaultWith(page, stack.vault, { "notes/page.html": "Welcome.md" });
    await find(page, "page.html");
    await page.getByRole("option", { name: /notes\/page\.html/ }).click();
    await expect(page.locator('[data-html-pane] iframe[title="notes/page.html"]')).toBeVisible();
  });

  test("Enter on an epub with a note opens the book over the focused pane, and one with no note in a new tab", async ({
    page,
    stack,
  }) => {
    const read: string[] = [];
    page.on("request", (request) => {
      const url = decodeURIComponent(request.url());
      if (url.includes("/api/books/")) read.push(url.replace(/^.*\/api\/books\//, ""));
    });
    await vaultWith(page, stack.vault, {
      "lit/DDIA.md": "Welcome.md",
      "lit/DDIA.epub": EPUB,
      "lit/Solo.epub": EPUB,
    });
    await find(page, "DDIA.epub");
    await expect(selected(page)).toContainText("lit/DDIA.epub");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-book-pane]")).toBeVisible({ timeout: 15_000 });
    expect([await page.locator("[data-pane]").count(), read]).toEqual([1, ["lit/DDIA.md"]]);

    await find(page, "Solo.epub");
    await expect(selected(page)).toContainText("lit/Solo.epub");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened))
      .toEqual(["/api/assets/lit/Solo.epub"]);
    expect(read).toEqual(["lit/DDIA.md"]);
  });

  test("an archived pdf stays off the finder until Space a shows the archive", async ({
    page,
    stack,
  }) => {
    await vaultWith(page, stack.vault, { "98 Archive/old.pdf": PRIMER });
    const names = page.getByRole("option");
    await find(page, ".pdf");
    // One poll: the pdf outside the archive listed while the archived one is not.
    await expect
      .poll(async () => (await names.allTextContents()).map((name) => name.replace(/\s*PDF$/, "")))
      .toEqual([PRIMER]);
    await page.keyboard.press("Escape");
    await leader(page, "a");
    await find(page, ".pdf");
    await expect.poll(async () => (await names.allTextContents()).length).toBe(2);
    await expect(page.getByRole("option", { name: /98 Archive\/old\.pdf/ })).toBeVisible();
  });

  test.describe("with vim off", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    });

    test("the palette's Find a note opens the finder, and Enter on a pdf row opens it", async ({
      page,
    }) => {
      await openApp(page);
      await page.keyboard.press("Control+Shift+P");
      await page.getByRole("option", { name: /^Find a note/ }).click();
      const input = page.getByRole("dialog", { name: "Find note" }).getByRole("combobox");
      await expect(input).toBeFocused();
      await input.fill("Primer.pdf");
      await expect(selected(page)).toContainText(PRIMER);
      await page.keyboard.press("Enter");
      await expect(pdfPane(page, PRIMER)).toBeVisible();
    });
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("the finder opened from the thumb row opens the note it finds", async ({ page }) => {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Find a note" }).tap();
    const finder = page.getByRole("dialog", { name: "Find note" });
    await finder.getByRole("combobox").fill("Garden");
    await finder
      .getByRole("option", { name: /Garden/ })
      .first()
      .tap();
    await expect(finder).toBeHidden();
    await expect(page.locator(".cm-content")).toContainText("water the tomatoes");
  });

  test("the finder gives its list the screen's width and each row a thumb's height", async ({
    page,
  }) => {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Find a note" }).tap();
    const list = page.getByRole("dialog", { name: "Find note" }).getByRole("listbox");
    await expect(list.getByRole("option").first()).toBeVisible();
    // A row is highlighted, yet a phone has no room for the preview beside the list.
    await expect(
      page.getByRole("dialog", { name: "Find note" }).getByTestId("preview"),
    ).toHaveCount(0);
    const [listWidth, panelWidth] = await list.evaluate((el) => [
      el.getBoundingClientRect().width,
      el.parentElement?.getBoundingClientRect().width ?? 0,
    ]);
    expect(listWidth).toBeCloseTo(panelWidth, 0);
    // The rule, not the box: a row's padding alone may already reach 44 px.
    const minHeight = await list
      .getByRole("option")
      .first()
      .evaluate((el) => getComputedStyle(el).minHeight);
    expect(minHeight).toBe("44px");
  });
  test("a tap on run, Find a note and a pdf row opens the pdf", async ({ page }) => {
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Find a note/ }).tap();
    await page.getByRole("dialog", { name: "Find note" }).getByRole("combobox").fill("Primer.pdf");
    await page.getByRole("option", { name: /04 Books\/Primer\.pdf/ }).tap();
    await expect(page.locator('[data-pdf-pane="04 Books/Primer.pdf"]')).toBeVisible();
  });
});
