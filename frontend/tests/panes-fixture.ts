import { focusedPane, type Layout, tabPanes } from "@/lib/panes";

/**
 * Read an index the compiler will not trust.
 *
 * `noUncheckedIndexedAccess` is on, and a missing pane in one of these is the
 * failure the test is looking for anyway, so it says which index was empty
 * rather than reporting `undefined` two lines later.
 */
export function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`nothing at ${index} of ${items.length}`);
  return item;
}

/** The focused pane's note, or null while it holds none. Most tests read this. */
export function open(layout: Layout): string | null {
  return focusedPane(layout).path ?? null;
}

/** Every note on screen in the active tab, in the order the panes sit in. */
export function notes(layout: Layout): (string | null)[] {
  return tabPanes(layout).map((pane) => pane.path ?? null);
}
