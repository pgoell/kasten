import type { Page, Route } from "@playwright/test";
import { leader, openApp, today } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

type Hit = { path: string; line: number; text: string; date: string; tags: string[] };

const hit = (path: string, line: number, text: string): Hit => ({
  path,
  line,
  text,
  date: today(),
  tags: [],
});

/** Answers every content search with `reply`'s hits rather than the vault's. */
async function answer(page: Page, reply: (route: Route) => Hit[] | Promise<Hit[]>) {
  await page.route("**/api/search?**", async (route) =>
    route.fulfill({ json: await reply(route) }),
  );
}

/** The vault's own hits for each query in turn, so a row opens a real note on a real line. */
async function vaultHits(route: Route, queries: string[]): Promise<Hit[]> {
  const hits: Hit[][] = [];
  for (const q of queries) {
    const url = new URL(route.request().url());
    url.searchParams.set("q", q);
    hits.push(await (await route.fetch({ url: url.toString() })).json());
  }
  return hits.flat();
}

// One line in each of two notes: Welcome's front door, then Long note's last todo.
const twoNotes = (route: Route) => vaultHits(route, ["front door", "far away letter"]);

/** Opens the search with `Space f g`, and waits for its input to hold the focus before keys go. */
async function openSearch(page: Page) {
  await openApp(page);
  await leader(page, "fg");
  await expect(page.getByRole("combobox", { name: "search notes" })).toBeFocused();
}

const rows = (page: Page) => page.getByRole("option");

test("the arrows walk across notes, and Enter opens the line the highlight lands on", async ({
  page,
}) => {
  await answer(page, twoNotes);
  await openSearch(page);
  await page.keyboard.type("the");
  await expect(rows(page)).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Long note", selected: true })).toBeVisible();
  await expect(page.locator(".cm-activeLine")).toContainText("reply to the far away letter");
});

test("with vim off, the palette opens the search and a click on a row opens its line", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await answer(page, twoNotes);
  await openApp(page);
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /Search note content/ }).click();
  await expect(page.getByRole("combobox", { name: "search notes" })).toBeFocused();
  await page.keyboard.type("the");
  await rows(page).nth(1).click();
  await expect(page.getByRole("tab", { name: "Long note", selected: true })).toBeVisible();
  await expect(page.locator(".cm-activeLine")).toContainText("reply to the far away letter");
});

test("each note groups its lines under a serif title, its path in mono, each line number muted, in its place in the entrance", async ({
  page,
}) => {
  await answer(page, () => [
    hit("Welcome.md", 3, "the front door"),
    hit("Long note.md", 252, "the letter"),
  ]);
  await openSearch(page);
  await page.keyboard.type("the");
  const first = page.getByRole("group", { name: "Welcome.md" });
  const second = page.getByRole("group", { name: "Long note.md" });
  // One poll: the entrance class goes on the first render after its timer ends.
  await expect
    .poll(async () => [
      await first.getAttribute("class"),
      await first.getAttribute("style"),
      await second.getAttribute("class"),
      await second.getAttribute("style"),
    ])
    .toEqual([
      expect.stringContaining("k-enter"),
      expect.stringContaining("--i: 0"),
      expect.stringContaining("k-enter"),
      expect.stringContaining("--i: 1"),
    ]);
  await expect(first.getByText("Welcome", { exact: true })).toHaveCSS("font-family", /Newsreader/);
  await expect(first.getByText("Welcome.md", { exact: true })).toHaveCSS(
    "font-family",
    /JetBrains Mono/,
  );
  const number = rows(page).first().getByText("3", { exact: true });
  await expect(number).toHaveCSS("font-family", /JetBrains Mono/);
  await expect(number).toHaveClass(/text-k-muted/);
});

test("every occurrence of the typed term is marked in the accent", async ({ page }) => {
  await answer(page, () => [hit("Welcome.md", 3, "Postgres and postgres again")]);
  await openSearch(page);
  await page.keyboard.type("postgres");
  await expect
    .poll(() => rows(page).first().locator(".text-k-accent").allTextContents())
    .toEqual(["Postgres", "postgres"]);
});

test("the status asks for a query, says it reads while the scan runs, and says when the counts stop at 2,000 lines", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  const lines = Array.from({ length: 2000 }, (_, at) => hit("Long note.md", at + 1, "postgres"));
  await answer(page, async () => {
    await held;
    return lines;
  });
  await openSearch(page);
  const status = page.getByRole("status");
  await expect(status).toHaveText("type to search every note");
  await page.keyboard.type("postgres");
  await expect(status).toHaveText("reading the vault");
  release();
  await expect(status).toContainText("Counts are of the first 2,000 lines.");
});

test("the highlight stays in view when it walks past the end of a long list and back", async ({
  page,
}) => {
  const lines = Array.from({ length: 60 }, (_, at) => hit("Long note.md", at + 5, "postgres"));
  await answer(page, () => lines);
  await openSearch(page);
  await page.keyboard.type("postgres");
  await expect(rows(page)).toHaveCount(60);
  await expect(rows(page).last()).not.toBeInViewport();
  for (let at = 0; at < 62; at++) await page.keyboard.press("ArrowDown");
  await expect(rows(page).last()).toHaveAttribute("aria-selected", "true");
  await expect(rows(page).last()).toBeInViewport();
  await expect(rows(page).first()).not.toBeInViewport();
  for (let at = 0; at < 59; at++) await page.keyboard.press("ArrowUp");
  await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(rows(page).first()).toBeInViewport();
});
