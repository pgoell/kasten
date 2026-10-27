/**
 * The food sheet as the Log card shows it: one panel per view, mounted while the
 * card's `food` flag is open and taken down when it shuts. The card owns the flag
 * and the writes; this owns the panel and the DOM it lives in.
 */

import type { EditorView } from "@codemirror/view";
import { hideFoodSheet, showFoodSheet } from "@/components/food-sheet";
import { type FoodPanel, foodPanel } from "@/lib/food-search";
import type { FoodGoals } from "@/lib/log-kinds";
import type { DrinkTotals } from "@/lib/log-lines";
import { dailyDate } from "@/lib/periodic";
import { notePath } from "@/lib/todo/todo-commands";

/** What the sheet asks of the card: a line to write, a close, and today's food for the preview. */
export interface SheetHooks {
  log: (line: string) => void;
  close: () => void;
  today: () => { eaten: DrinkTotals["food"]; goals: FoodGoals };
}

/** The panel of each view while its sheet is up. */
const sheets = new WeakMap<EditorView, FoodPanel>();

/**
 * Shows the sheet when `open`, and takes it down when not. Called after a dispatch
 * returns, never inside an update, so the query is in the page when that returns.
 * Idempotent, so a second call for the same state changes nothing.
 */
export function syncFoodSheet(view: EditorView, open: boolean, hooks: SheetHooks): void {
  const panel = sheets.get(view);
  if (open && panel === undefined) {
    const path = view.state.facet(notePath);
    const made = foodPanel(path === undefined ? null : dailyDate(path), hooks);
    sheets.set(view, made);
    showFoodSheet(view, made, hooks.close);
  } else if (!open && panel !== undefined) {
    panel.stop();
    sheets.delete(view);
    hideFoodSheet(view);
  }
}

/** Stops the camera of a view's sheet when the view goes away. */
export function stopFoodSheet(view: EditorView): void {
  sheets.get(view)?.stop();
  sheets.delete(view);
}
