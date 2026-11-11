import type { Page } from "@playwright/test";
import { openApp, phone, tapHeight } from "../../harness/app.ts";
import { answer, bars, daysAgo, type Hit, hit, openSearch } from "../../harness/search.ts";
import { expect, test } from "../../harness/stack.ts";

const HITS: Hit[] = [
  hit("projects/kasten.md", 12, "Postgres holds a derived index.", daysAgo(0), ["#db"]),
  hit("reference/deploy.md", 88, "postgres runs in its own container", daysAgo(7), ["#reading"]),
];

/** What only the archive-in answer carries beside `HITS`. */
const ARCHIVED = [hit("98 Archive/old.md", 3, "postgres in the old plan", daysAgo(0), ["#db"])];

/** Answers with `hits`, and the archive's lines too when the request asks for them; returns each request's `archive`. */
async function answerArchive(page: Page, hits: Hit[]): Promise<string[]> {
  const asked: string[] = [];
  await answer(page, (route) => {
    const archive = new URL(route.request().url()).searchParams.get("archive") ?? "";
    asked.push(archive);
    return archive === "true" ? [...hits, ...ARCHIVED] : hits;
  });
  return asked;
}

const rows = (page: Page) => page.getByRole("option");
const filter = (page: Page, name: RegExp) => page.getByRole("button", { name });

test("the filter column is 220 pixels wide and counts each folder's, each tag's, the root's and the archive's lines", async ({
  page,
}) => {
  const asked = await answerArchive(page, [
    ...HITS,
    hit("index.md", 2, "postgres at the root", daysAgo(0)),
  ]);
  await openSearch(page);
  await expect
    .poll(
      async () => (await page.getByRole("complementary", { name: "Filters" }).boundingBox())?.width,
    )
    .toBe(220);
  await page.keyboard.type("postgres");
  await expect(rows(page)).toHaveCount(3);
  await expect(filter(page, /^projects/)).toHaveText("projects1");
  await expect(filter(page, /^#db/)).toHaveText("#db1");
  await expect(filter(page, /^\/\s*1$/)).toBeVisible();
  // The archive's count comes from a second question to the vault, with the archive in.
  await expect(filter(page, /^Include the archive/)).toHaveText("Include the archive1");
  expect(asked).toContain("true");
});

test("a folder narrows the lines and the bars, keeps every folder's count, clears on a second press, and a tag narrows too", async ({
  page,
}) => {
  await answer(page, () => [
    ...HITS,
    ...[1, 2, 3].map((line) => hit("reference/more.md", line, "postgres", daysAgo(14))),
  ]);
  await openSearch(page);
  await page.keyboard.type("postgres");
  await expect(rows(page)).toHaveCount(5);
  const reference = filter(page, /^reference/);
  await reference.click();
  await expect(rows(page)).toHaveCount(4);
  await expect(bars(page).nth(11)).toHaveAccessibleName(/, 3 lines$/);
  await expect(bars(page).last()).toHaveAccessibleName(/, 0 lines$/);
  await expect(filter(page, /^projects/)).toHaveText("projects1");
  await expect(reference).toHaveText("reference4");
  await reference.click();
  await expect(rows(page)).toHaveCount(5);
  await expect(reference).toHaveAttribute("aria-pressed", "false");
  await filter(page, /^#reading/).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(bars(page).nth(12)).toHaveAccessibleName(/, 1 line$/);
  await expect(bars(page).last()).toHaveAccessibleName(/, 0 lines$/);
});

test("a press on the archive flips it in and lists its lines", async ({ page }) => {
  await answerArchive(page, HITS);
  await openSearch(page);
  await page.keyboard.type("postgres");
  await expect(rows(page)).toHaveCount(2);
  const archive = filter(page, /^Include the archive/);
  await archive.click();
  await expect(archive).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole("group", { name: "98 Archive/old.md" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("the filters fold into a Filters button that names the chosen folder, and a bar, a filter and a line take a finger", async ({
    page,
  }) => {
    await answer(page, () => HITS);
    // A phone has no tree and no leader key, so the page opens on a cold load of a week.
    await page.goto("/?week=2020-W01");
    await page.getByRole("button", { name: "All weeks" }).tap();
    await page.getByRole("combobox", { name: "search notes" }).fill("postgres");
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByRole("complementary", { name: "Filters" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Folders" })).toHaveCount(0);
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    await filters.tap();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("group", { name: "Folders" })).toBeVisible();
    for (const target of [bars(page).last(), filter(page, /^projects/), rows(page).first()])
      expect(await tapHeight(target)).toBeGreaterThanOrEqual(44);
    await filter(page, /^projects/).tap();
    await page.getByRole("button", { name: /^Filters/ }).tap();
    await expect(page.getByRole("button", { name: "Filters, projects" })).toBeVisible();
  });

  test("a line moved to where float32 loses a step still reads 44 pixels tall", async ({
    page,
  }) => {
    await answer(page, () => HITS);
    await page.goto("/?week=2020-W01");
    await page.getByRole("button", { name: "All weeks" }).tap();
    await page.getByRole("combobox", { name: "search notes" }).fill("postgres");
    const line = rows(page).first();
    await expect(line).toBeVisible();
    // The list's 240 ms slide in; settled, since a render that drops `k-enter` cancels it.
    await line.evaluate((e) =>
      Promise.allSettled(
        (e.closest(".k-enter")?.getAnimations() ?? []).map((animation) => animation.finished),
      ),
    );
    const top = (await line.boundingBox())?.y ?? 0;
    expect(await line.evaluate((e) => (e as HTMLElement).offsetHeight)).toBe(44);
    // Tops from 990 to 1024 px, where the bottom edge crosses 1024 and the runner's line read 43.99994 (#1852).
    for (let i = 0; i < 80; i++) {
      await line.evaluate(
        (e, by) => {
          e.style.transform = `translateY(${by}px)`;
        },
        990 - top + i * 0.4237,
      );
      expect(await tapHeight(line)).toBeGreaterThanOrEqual(44);
    }
  });
});

// #1773: the regex and whole word toggles, against the real vault. Quote holds "plant",
// Home holds "plants".
test.describe("the regex and whole word toggles", () => {
  const search = (page: Page) => page.getByRole("combobox", { name: "search notes" });
  const regex = (page: Page) => page.getByRole("button", { name: "Regular expression" });
  const word = (page: Page) => page.getByRole("button", { name: "Whole word" });
  const lines = (page: Page) => page.getByRole("option");
  const asked = (page: Page, flag: string) =>
    page.waitForRequest((request) => new URL(request.url()).searchParams.get(flag) === "true");

  test("with vim on, Alt+R reads the query as a regex: \\bplant\\b finds plant and not plants", async ({
    page,
  }) => {
    await openSearch(page);
    const literal = page.waitForRequest("**/api/search?**");
    await page.keyboard.type("plant");
    const plain = new URL((await literal).url()).searchParams;
    expect([plain.has("regex"), plain.has("word")]).toEqual([false, false]);
    await expect(lines(page)).toHaveCount(2);

    const sent = asked(page, "regex");
    await page.keyboard.press("Alt+r");
    await expect(regex(page)).toHaveAttribute("aria-pressed", "true");
    await expect(search(page)).toBeFocused();
    await search(page).fill("\\bplant\\b");
    await sent;

    await expect(lines(page)).toHaveCount(1);
    await expect(lines(page)).toContainText("The best time to plant a tree");

    await search(page).fill("(plant");
    await expect(page.getByRole("status")).toContainText("unclosed group");
    await expect(lines(page)).toHaveCount(0);
  });

  test("with vim off, Alt+W keeps whole words only", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    await openApp(page);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /Search note content/ }).click();
    await expect(search(page)).toBeFocused();
    await page.keyboard.type("plant");
    await expect(lines(page)).toHaveCount(2);

    const sent = asked(page, "word");
    await page.keyboard.press("Alt+w");
    await sent;

    await expect(word(page)).toHaveAttribute("aria-pressed", "true");
    await expect(lines(page)).toHaveCount(1);
    await expect(lines(page)).toContainText("The best time to plant a tree");
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("a tap on each toggle sets it, and the keyboard keeps the field", async ({ page }) => {
      await page.goto("/?week=2020-W01");
      await page.getByRole("button", { name: "All weeks" }).tap();
      for (const toggle of [regex(page), word(page)]) {
        expect(await tapHeight(toggle)).toBeGreaterThanOrEqual(44);
        expect((await toggle.boundingBox())?.width).toBeGreaterThanOrEqual(44);
      }

      await regex(page).tap();
      await word(page).tap();
      await expect(search(page)).toBeFocused();
      const both = page.waitForRequest((request) => {
        const params = new URL(request.url()).searchParams;
        return params.get("regex") === "true" && params.get("word") === "true";
      });
      await search(page).fill("plants?");
      await both;

      await expect(regex(page)).toHaveAttribute("aria-pressed", "true");
      await expect(word(page)).toHaveAttribute("aria-pressed", "true");
      await expect(lines(page)).toHaveCount(2);
    });
  });
});
