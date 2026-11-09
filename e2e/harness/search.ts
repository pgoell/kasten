import { expect, type Page, type Route } from "@playwright/test";
import { leader, openApp } from "./app.ts";

export type Hit = { path: string; line: number; text: string; date: string; tags: string[] };

/** The date `days` before today on this box, as a hit carries it. */
export function daysAgo(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
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
