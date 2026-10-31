import { paneTitle } from "@/lib/pane-kinds";
import { type Pane, panesOf, type Tab } from "@/lib/panes";

/** The pane a tab left focused: the one it is named and drawn by. */
export function focusedOf(tab: Tab): Pane | undefined {
  return panesOf(tab.root).find((pane) => pane.id === tab.focus);
}

/** What one tab is called: what is in the pane it left focused. */
export function tabLabel(tab: Tab): string {
  const focused = focusedOf(tab);
  return focused === undefined ? "New tab" : paneTitle(focused);
}
