import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { phone, readAll } from "../../harness/app.ts";
import { root } from "../../harness/paths.ts";
import { answer, bar, type Hit, hit, openSearch } from "../../harness/search.ts";
import { expect, test } from "../../harness/stack.ts";

const HITS: Hit[] = [
  hit("projects/kasten.md", 12, "Postgres holds a derived index."),
  hit("reference/deploy.md", 88, "postgres runs in its own container"),
];

const PDF: Hit = {
  ...hit("docs/Plan.pdf", 3, "postgres budget for March", "2026-10-20", ["#db"]),
  place: { kind: "pdf", label: "page 3", page: 3 },
};
const EPUB: Hit = {
  ...hit("reading/Book.epub", 912, "postgres in the second chapter", "2026-09-16", ["#reading"]),
  place: { kind: "epub", label: "Chapter 2, 41%" },
};
const HTML: Hit = {
  ...hit("reference/Guide.html", 20, "postgres needs a role", "2026-10-20"),
  place: { kind: "html", label: "Roles", anchor: "roles" },
};

const rows = (page: Page) => page.getByRole("option");
const input = (page: Page) => page.getByRole("combobox", { name: "search notes" });
const filter = (page: Page, name: RegExp) => page.getByRole("button", { name });

test("the vault is asked once for the settled query with the archive out, and an empty answer says no notes match", async ({
  page,
}) => {
  const asked: string[] = [];
  await answer(page, (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q") ?? "";
    // The recent notes ask the search too, by their `modified:` date.
    if (url.searchParams.get("archive") === "false" && !q.startsWith("modified:")) asked.push(q);
    return q === "wikilink" ? [] : HITS;
  });
  // Installed before load, so no timer the app keeps escapes it.
  await page.clock.install();
  await openSearch(page);
  // The page's clock moves only when told, so a slow runner between keys cannot settle early.
  await page.clock.pauseAt(Date.now() + 1000);
  for (const key of "pos") {
    await page.keyboard.press(key);
    // Under the search's 120 ms settle, so a scan per key would show.
    await page.clock.runFor(100);
  }
  await page.clock.runFor(120);
  // Time flows again for the query's own timers; every key is in by now.
  await page.clock.resume();
  // One poll: the rows land with the answer to the one question asked.
  await expect.poll(async () => [await rows(page).count(), asked]).toEqual([2, ["pos"]]);
  await input(page).fill("wikilink");
  await expect
    .poll(async () => [await rows(page).count(), await page.getByRole("status").textContent()])
    .toEqual([0, "no notes match"]);
});

test("the lines in hand narrow while the next answer is on its way", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  await answer(page, async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") !== "postgres") await held;
    return HITS;
  });
  await openSearch(page);
  await page.keyboard.type("postgres");
  await expect(rows(page)).toHaveCount(2);
  await page.keyboard.type(" container");
  await expect
    .poll(async () => [
      await rows(page).count(),
      await rows(page).first().textContent(),
      await page.getByRole("status").textContent(),
    ])
    .toEqual([1, expect.stringContaining("in its own container"), "reading the vault"]);
  release();
});

test("the lines are ranked against the query rather than kept in the order the vault sent", async ({
  page,
}) => {
  // The vault answers in path order, so the loose match comes first.
  await answer(page, () => [
    hit("a.md", 1, "return the unit to nine sets"),
    hit("b.md", 2, "the job runs nightly"),
  ]);
  await openSearch(page);
  await page.keyboard.type("runs");
  await expect
    .poll(async () =>
      (await readAll(page, '[role="group"]', (all) => all.map((g) => g.ariaLabel))).filter((name) =>
        name?.endsWith(".md"),
      ),
    )
    .toEqual(["b.md", "a.md"]);
});

test("a pdf, an epub and an html line show their page, chapter and heading, under the file's name and kind", async ({
  page,
}) => {
  await answer(page, () => [PDF, EPUB, HTML]);
  await openSearch(page);
  await page.keyboard.type("postgres");
  await expect(rows(page)).toHaveCount(3);
  const pdf = page.getByRole("group", { name: "docs/Plan.pdf" });
  await expect(pdf.getByRole("option")).toHaveText(/page 3\s*postgres budget for March/);
  await expect(pdf).toContainText("Plan.pdf");
  await expect(pdf).toContainText("PDF");
  const epub = page.getByRole("group", { name: "reading/Book.epub" });
  await expect(epub.getByRole("option")).toContainText("Chapter 2, 41%");
  await expect(epub).toContainText("EPUB");
  const html = page.getByRole("group", { name: "reference/Guide.html" });
  await expect(html.getByRole("option")).toContainText("Roles");
  await expect(html).toContainText("HTML");
});

test("a folder and a tag narrow the file lines, and a file line counts in the week of its date", async ({
  page,
}) => {
  // Friday 23 October 2026 at local noon: week 43 is this week, week 30 the first bar.
  await page.clock.setFixedTime(new Date(2026, 9, 23, 12));
  await answer(page, () => [PDF, EPUB]);
  await openSearch(page);
  await page.keyboard.type("postgres");
  await expect(rows(page)).toHaveCount(2);
  await expect(bar(page, 43)).toHaveAccessibleName("Week 43, 1 line");
  await expect(bar(page, 38)).toHaveAccessibleName("Week 38, 1 line");
  await expect(bar(page, 30)).toHaveAccessibleName("Week 30, 0 lines");
  const docs = filter(page, /^docs/);
  await docs.click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("postgres budget for March");
  await docs.click();
  await expect(rows(page)).toHaveCount(2);
  await filter(page, /^#reading/).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("postgres in the second chapter");
});

test.describe("Enter on a file's hit", () => {
  /** Puts an html page and an epub beside its note in the vault, answers each query with its hit, and takes it with Enter. */
  async function takeHit(page: Page, vault: string, query: "budget" | "role" | "fixture") {
    await mkdir(join(vault, "reference"), { recursive: true });
    await writeFile(join(vault, "reference/Guide.html"), "<h2 id=roles>Roles</h2>");
    await mkdir(join(vault, "reading"), { recursive: true });
    // No reading place in the note, so the book would open at its first chapter.
    await writeFile(join(vault, "reading/Book.md"), "# Book\n");
    await copyFile(
      join(root, "frontend/tests/fixtures/contents.epub"),
      join(vault, "reading/Book.epub"),
    );
    const hits = {
      budget: { ...PDF, path: "04 Books/Primer.pdf" },
      role: HTML,
      fixture: { ...EPUB, text: "Chapter Two of the fixture, with words to click on." },
    };
    await answer(page, (route) =>
      new URL(route.request().url()).searchParams.get("q") === query ? [hits[query]] : [],
    );
    await openSearch(page);
    await input(page).fill(query);
    await expect(rows(page)).toHaveCount(1);
    await page.keyboard.press("Enter");
  }

  test("opens a pdf at the hit's page", async ({ page, stack }) => {
    await takeHit(page, stack.vault, "budget");
    await expect(page.locator('[data-pdf-pane="04 Books/Primer.pdf"]')).toHaveAttribute(
      "data-page",
      "3",
    );
  });

  test("opens an html page at the hit's heading", async ({ page, stack }) => {
    await takeHit(page, stack.vault, "role");
    await expect
      .poll(
        async () =>
          (await page.locator("[data-html-pane] iframe").getAttribute("src"))?.split("#")[1],
      )
      .toBe("roles");
  });

  test("opens an epub through its note at the hit's passage", async ({ page, stack }) => {
    await takeHit(page, stack.vault, "fixture");
    await expect(page.locator("[data-book-pane] header")).toContainText("Two", { timeout: 15_000 });
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a tap on a pdf line opens the pdf at its page", async ({ page }) => {
    await answer(page, () => [
      {
        ...hit("04 Books/Primer.pdf", 3, "postgres on the third page"),
        place: { kind: "pdf", label: "page 3", page: 3 },
      },
    ]);
    // A phone has no tree and no leader key, so the page opens on a cold load of a week.
    await page.goto("/?week=2020-W01");
    await page.getByRole("button", { name: "All weeks" }).tap();
    await input(page).fill("postgres");
    await rows(page).first().tap();
    await expect(page.locator('[data-pdf-pane="04 Books/Primer.pdf"]')).toHaveAttribute(
      "data-page",
      "3",
    );
  });
});
