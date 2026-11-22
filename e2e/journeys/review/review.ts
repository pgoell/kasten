import type { Page } from "@playwright/test";
import { leader, openApp, runCommand, vaultWith } from "../../harness/app.ts";
import { expect } from "../../harness/stack.ts";

/**
 * Loads the app and opens the review pane on its overview, with the focus in it: by Space g s,
 * or from the palette, which vim off reaches too. `settled` waits for the last deck row first.
 */
export async function openReview(
  page: Page,
  { palette = false, settled = false } = {},
): Promise<void> {
  await openApp(page);
  await (palette ? runCommand(page, /^Open the review pane/) : leader(page, "gs"));
  if (settled) await expect(page.locator("button[data-deck]").last()).toBeVisible();
  await page.getByRole("heading", { name: "Review" }).click();
}

/** Writes `notes` over the fixture's own deck emptied, so the counts are theirs, and opens the overview at noon on 24 October 2026. */
export async function openDecks(page: Page, vault: string, notes: Record<string, string>) {
  await vaultWith(vault, { "03 Flashcards/Capitals.md": "# Capitals\n", ...notes });
  await page.clock.setFixedTime(new Date(2026, 9, 24, 12));
  await openReview(page, { settled: true });
}

/** Counts the PUTs that write one of `notes`, from here on. */
export function countPuts(page: Page, ...notes: string[]): () => number {
  let puts = 0;
  page.on("request", (r) => {
    const path = decodeURIComponent(r.url());
    if (r.method() === "PUT" && notes.some((note) => path.endsWith(note))) puts += 1;
  });
  return () => puts;
}

/** Turns the card and rates it `name`, then waits for the answer to the PUT of `note`. */
export async function rate(page: Page, note: string, name: string): Promise<void> {
  const landed = page.waitForResponse(
    (r) => r.request().method() === "PUT" && decodeURIComponent(r.url()).endsWith(note),
  );
  await page.getByRole("button", { name: "Show the answer" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await landed;
}

/** Writes `notes` and taps into `deck` from the home screen, as a phone gets there. */
export async function tapDeck(
  page: Page,
  vault: string,
  notes: Record<string, string>,
  deck: string,
) {
  await vaultWith(vault, notes);
  await page.goto("/");
  await page.getByRole("button", { name: /cards? waiting$/ }).tap();
  await page.locator(`button[data-deck="${deck}"]`).tap();
}

/** Writes `notes`, opens the review pane and sits `deck`, waiting for its first card. */
export async function sitDeck(
  page: Page,
  vault: string,
  notes: Record<string, string>,
  deck: string,
) {
  await vaultWith(vault, notes);
  await openReview(page);
  await page.locator(`button[data-deck="${deck}"]`).click();
  await expect(page.getByTestId("review-card")).not.toBeEmpty();
}
