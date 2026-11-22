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
