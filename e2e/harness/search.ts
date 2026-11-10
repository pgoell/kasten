import { expect, type Page, type Route } from "@playwright/test";
import { leader, localDate, noteText, openApp } from "./app.ts";

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
