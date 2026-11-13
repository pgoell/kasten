import { expect, type Page, type Route } from "@playwright/test";
import { findNote, leader, localDate, noteText, openApp } from "./app.ts";

/** A matched line; a note with no date in its name or frontmatter answers `date: null`. A file's line carries its `place`. */
export type Hit = {
  path: string;
  line: number;
  text: string;
  date: string | null;
  tags: string[];
  place?: { kind: "pdf" | "epub" | "html"; label: string; page?: number; anchor?: string };
};

/** The date `days` before today on this box, as a hit carries it. */
export function daysAgo(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  return localDate(at);
}

/** A line of a note, dated today unless `date` says otherwise. */
export const hit = (
  path: string,
  line: number,
  text: string,
  date = daysAgo(0),
  tags: string[] = [],
): Hit => ({
  path,
  line,
  text,
  date,
  tags,
});

/** Answers every content search with `reply`'s hits rather than the vault's. */
export async function answer(page: Page, reply: (route: Route) => Hit[] | Promise<Hit[]>) {
  await page.route("**/api/search?**", async (route) =>
    route.fulfill({ json: await reply(route) }),
  );
}

/** Opens the search with `Space f g`, and waits for its input to hold the focus before keys go. */
export async function openSearch(page: Page) {
  await openApp(page);
  await leader(page, "fg");
  await expect(page.getByRole("combobox", { name: "search notes" })).toBeFocused();
}

/** The histogram's fourteen bars, oldest first: the last is this week. */
export const bars = (page: Page) => page.getByRole("button", { name: /^Week \d+,/ });
/** The bars as `readAll` finds them. */
export const BARS = 'button[aria-label^="Week "]';

/** The bar of ISO week `week`, by its name. */
export const bar = (page: Page, week: number) =>
  page.getByRole("button", { name: new RegExp(`^Week ${week},`) });

/** Opens the backlinks or todos panel by its leader keys, and waits for its input's focus. */
export async function openPanel(page: Page, keys: string, name: "backlinks" | "todos") {
  await leader(page, keys);
  await expect(page.getByRole("combobox", { name })).toBeFocused();
}

/** The 1-based line of `path` in the test's vault that holds `words`: the vault adds frontmatter on load. */
export async function lineOf(vault: string, path: string, words: string): Promise<number> {
  return (await noteText(vault, path)).split("\n").findIndex((line) => line.includes(words)) + 1;
}

/** Opens the backlinks of the Garden note, the vault answering its name with `hits`, `ready` run just before the panel opens; returns what was asked. */
export async function gardenBacklinks(
  page: Page,
  hits: Hit[] | (() => Promise<Hit[]>),
  narrow = false,
  ready = async () => {},
): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/api/search?**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    // The recent notes ask the search too, by their `modified:` date.
    if (q.startsWith("modified:")) return route.fallback();
    asked.push(q);
    const answer = typeof hits === "function" ? await hits() : hits;
    await route.fulfill({ json: q === "Garden" ? answer : [] });
  });
  await page.route("**/api/mentions?**", (route) => route.fulfill({ json: [] }));
  await openApp(page);
  await findNote(page, "Garden");
  // The app opens wide, since a narrow window has no tree to open the note from.
  if (narrow) await page.setViewportSize({ width: 600, height: 900 });
  await ready();
  await openPanel(page, "gb", "backlinks");
  return asked;
}
