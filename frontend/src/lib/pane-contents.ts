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

/** Put a terminal in the focused pane, replacing whatever was there. */
export function openTerminalInFocused(layout: Layout, session: string): Layout {
  return fillFocused(layout, { term: session });
}

/** Put the chat in the focused pane, replacing whatever was there. */
export function openChatInFocused(layout: Layout): Layout {
  return fillFocused(layout, { chat: true });
}

/** Put the todo list in the focused pane, replacing whatever was there. */
export function openTodosInFocused(layout: Layout): Layout {
  return fillFocused(layout, { todos: true });
}

/** Put the log in the focused pane, replacing whatever was there. */
export function openLogInFocused(layout: Layout): Layout {
  return fillFocused(layout, { log: true });
}

/** Put the overview in the focused pane, replacing whatever was there. */
export function openOverviewInFocused(layout: Layout): Layout {
  return fillFocused(layout, { overview: true });
}

/** Put the finance pane in the focused pane, over it for the reason the overview is. */
export function openFinanceInFocused(layout: Layout): Layout {
  return fillFocused(layout, { finance: true });
}

/** Put the review in the focused pane, replacing whatever was there. */
export function openReviewInFocused(layout: Layout): Layout {
  return fillFocused(layout, { review: true });
}

/**
 * Sit a note's exam over the focused pane. Beside it, the answers would sit by the questions.
 */
export function openExamInFocused(layout: Layout, note: string): Layout {
  return fillFocused(layout, { exam: note });
}

/** Show an image in the focused pane, replacing whatever was there. */
export function openImageInFocused(layout: Layout, path: string): Layout {
  return fillFocused(layout, { image: path });
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

/** Show an HTML page in the focused pane. `anchor` is the heading a followed link named. */
export function openHtmlInFocused(layout: Layout, path: string, anchor?: string): Layout {
  return fillFocused(layout, { html: path, anchor });
}

/**
 * Put a note's book in a new pane beside it, or go to the pane already reading it.
 */
export function openBookBeside(layout: Layout, note: string): Layout {
  const reading = tabPanes(layout).find((pane) => pane.book === note);
  if (reading) return focusPane(layout, reading.id);

  const split = splitFocused(layout, "row");
  return fillFocused(split, { book: note });
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
 * Play a note's video in a new pane beside it, or go to the one already playing it. Beside, so the
 * note stays open to write in.
 */
export function openVideoBeside(layout: Layout, note: string): Layout {
  const playing = tabPanes(layout).find((pane) => pane.video === note);
  if (playing) return focusPane(layout, playing.id);

  // `col` rather than the book's `row`: a 16:9 player wants the width.
  const split = splitFocused(layout, "col");
  return fillFocused(split, { video: note });
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

/** Put a note beside this pane, or go to the pane in this tab already holding it. */
export function openNoteBeside(layout: Layout, path: string): Layout {
  const holding = tabPanes(layout).find((pane) => pane.path === path);
  if (holding) return focusPane(layout, holding.id);

  const split = splitFocused(layout, "row");
  return fillFocused(split, { path });
}

/** Put one person's card beside this pane, or go to the one showing it. */
export function openPersonBeside(layout: Layout, person: string): Layout {
  const showing = tabPanes(layout).find((pane) => pane.person === person);
  if (showing) return focusPane(layout, showing.id);

  // `row`: a card is short lines and reads beside a note.
  const split = splitFocused(layout, "row");
  return fillFocused(split, { person });
}

/**
 * Put a note's history beside it, or go to the pane already listing it. On a narrow window the
 * history takes the screen, as the route draws the focused pane alone.
 */
export function openHistoryBeside(layout: Layout, note: string): Layout {
  const listing = tabPanes(layout).find((pane) => pane.history === note);
  if (listing) return focusPane(layout, listing.id);

  const split = splitFocused(layout, "row");
  return fillFocused(split, { history: note });
}

/** Put the graph of the whole vault in the focused pane, replacing whatever was there. */
export function openGraphInFocused(layout: Layout): Layout {
  return fillFocused(layout, { graph: {} });
}

/** Put the graph around a note in a pane beside it, or go to the one already drawing it. */
export function openGraphBeside(layout: Layout, note: string): Layout {
  const drawing = tabPanes(layout).find((pane) => pane.graph?.around === note);
  if (drawing) return focusPane(layout, drawing.id);

  const split = splitFocused(layout, "row");
  return fillFocused(split, { graph: { around: note } });
}

/** Take the note out of the focused pane, leaving the pane itself on screen. */
export function clearFocused(layout: Layout): Layout {
  return fillFocused(layout, {});
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
