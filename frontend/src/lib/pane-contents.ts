/**
 * Opens a pane's contents, over or beside the focused one. The tree's shape stays in `panes.ts`.
 */

import {
  fillFocused,
  focusedPane,
  focusPane,
  isSplit,
  type Layout,
  type Pane,
  type PaneNode,
  type Split,
  splitFocused,
  tabPanes,
} from "@/lib/panes";

/**
 * Open a note in the focused pane. The pane is written whole, so no line from the last search hit
 * survives. The jump count carries over, so an open at a line always counts as new.
 */
export function openInFocused(layout: Layout, path: string, line?: number): Layout {
  const jump = line === undefined ? undefined : (focusedPane(layout).jump ?? 0) + 1;
  return fillFocused(layout, { path, line, jump });
}

/**
 * Show a pdf at its first page in the focused pane. A followed link takes `openPdfBeside` instead.
 * `opened` counts on from the pane's own count, so a repeat click turns back to page 1 (#361).
 * `page` is where a search hit opens it.
 */
export function openPdfInFocused(layout: Layout, path: string, page?: number): Layout {
  const { pdf } = focusedPane(layout);
  const opened = (pdf?.path === path ? pdf.opened : 0) + 1;

  return fillFocused(layout, { pdf: { path, page, opened } });
}

/**
 * Go to the pane of this tab that `holds` picks, or split the focused pane in `dir` and fill the new
 * one with `content`. Beside, so the note it opens from stays open to write in.
 */
export function openBeside(
  layout: Layout,
  holds: (pane: Pane) => boolean,
  content: Omit<Pane, "id">,
  dir: Split["dir"],
): Layout {
  const holding = tabPanes(layout).find(holds);
  if (holding) return focusPane(layout, holding.id);

  return fillFocused(splitFocused(layout, dir), content);
}

/**
 * Put a note's book in the focused pane, or go to the one already reading it.
 * Over, not beside: the book finder (#502) picks a book, so no note is there to keep.
 */
export function openBookInFocused(layout: Layout, note: string): Layout {
  const reading = tabPanes(layout).find((pane) => pane.book === note);
  if (reading) return focusPane(layout, reading.id);

  return fillFocused(layout, { book: note });
}

/**
 * Show a pdf at a page beside this pane, or turn the pane already showing it.
 */
export function openPdfBeside(layout: Layout, path: string, page?: number): Layout {
  const showing = tabPanes(layout).find((pane) => pane.pdf?.path === path);
  const split = showing ? focusPane(layout, showing.id) : splitFocused(layout, "row");
  const opened = (showing?.pdf?.opened ?? 0) + 1;

  return fillFocused(split, { pdf: { path, page, opened } });
}

/**
 * Open the note a URL names over a restored layout, reusing a pane that already holds it.
 * A plain reload keeps the layout as it is; a line in the URL always jumps.
 */
export function openOnTop(layout: Layout, path: string, line?: number): Layout {
  if (focusedPane(layout).path === path) {
    return line === undefined ? layout : openInFocused(layout, path, line);
  }

  // The tab on screen first, so a note open in two tabs keeps you where you are.
  const order = [layout.active, ...layout.tabs.keys()];
  for (const at of order) {
    const onTab = { ...layout, active: at };
    const holding = tabPanes(onTab).find((pane) => pane.path === path);
    if (holding === undefined) continue;
    const there = focusPane(onTab, holding.id);
    return line === undefined ? there : openInFocused(there, path, line);
  }

  return openInFocused(layout, path, line);
}

/**
 * Rewrites every pane in every tab, so a moved note is followed everywhere. Keep each pane's id:
 * the tab uses it to track the focus.
 */
export function mapPanes(layout: Layout, fn: (pane: Pane) => Pane): Layout {
  function walk(node: PaneNode): PaneNode {
    return isSplit(node) ? { ...node, children: node.children.map(walk) } : fn(node);
  }

  return { ...layout, tabs: layout.tabs.map((tab) => ({ ...tab, root: walk(tab.root) })) };
}
