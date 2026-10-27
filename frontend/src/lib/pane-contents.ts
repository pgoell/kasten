/**
 * What a pane can be opened on, and where it opens.
 *
 * Each opener knows one kind of thing a pane holds: whether it replaces the
 * focused pane or splits beside it, which way a split runs, and whether a pane
 * already holding it is gone to rather than doubled. None of them touch the
 * tree: they write a pane whole through `fillFocused` in `panes.ts`, which keeps
 * the tree's shape that file's business alone.
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
 * Open a note in the focused pane.
 *
 * The pane is written whole rather than patched, so a line left over from the
 * search hit that opened the last note cannot survive into one that names none
 * and drop the cursor somewhere arbitrary. The jump count is the one thing
 * carried over, so an open at a line always counts as a new one.
 */
export function openInFocused(layout: Layout, path: string, line?: number): Layout {
  const jump = line === undefined ? undefined : (focusedPane(layout).jump ?? 0) + 1;
  return fillFocused(layout, { path, line, jump });
}

/**
 * Put a terminal in the focused pane, replacing whatever was there.
 *
 * Written whole for the reason `openInFocused` writes one whole: the note and
 * the line it opened on are gone, not left behind under a terminal.
 */
export function openTerminalInFocused(layout: Layout, session: string): Layout {
  return fillFocused(layout, { term: session });
}

/**
 * Put the chat in the focused pane, replacing whatever was there.
 *
 * Over the pane, the way a terminal is put over one: this is a place to work
 * in, not a thing read beside a note.
 */
export function openChatInFocused(layout: Layout): Layout {
  return fillFocused(layout, { chat: true });
}

/**
 * Put the todo list in the focused pane, replacing whatever was there.
 *
 * Written whole for the reason the two above write one whole: the note and the
 * line it opened on are gone, not left behind under the list.
 */
export function openTodosInFocused(layout: Layout): Layout {
  return fillFocused(layout, { todos: true });
}

/**
 * Put the log in the focused pane, replacing whatever was there.
 *
 * Over the pane, following `openTodosInFocused`: the log is the day's entries,
 * not a thing read beside a note.
 */
export function openLogInFocused(layout: Layout): Layout {
  return fillFocused(layout, { log: true });
}

/**
 * Put the overview in the focused pane, replacing whatever was there.
 *
 * Over the pane, following `openLogInFocused`: the overview is the whole week's
 * numbers, not a thing read beside a note.
 */
export function openOverviewInFocused(layout: Layout): Layout {
  return fillFocused(layout, { overview: true });
}

/** Put the finance pane in the focused pane, over it for the reason the overview is. */
export function openFinanceInFocused(layout: Layout): Layout {
  return fillFocused(layout, { finance: true });
}

/**
 * Put the review in the focused pane, replacing whatever was there.
 *
 * Over the pane rather than beside it, following `openTodosInFocused`: this is
 * a list of everything waiting, not a thing to read alongside a note.
 */
export function openReviewInFocused(layout: Layout): Layout {
  return fillFocused(layout, { review: true });
}

/**
 * Sit a note's practice exam in the focused pane, replacing whatever was there.
 *
 * Over the note rather than beside it, which is where this parts company with
 * `openBookBeside`. A book is read alongside the note you are writing about it;
 * an exam is the note, asked one question at a time, and putting the answers
 * next to the questions is exactly what a sitting must not do.
 */
export function openExamInFocused(layout: Layout, note: string): Layout {
  return fillFocused(layout, { exam: note });
}

/**
 * Show an image in the focused pane, replacing whatever was there.
 *
 * Over the pane rather than beside it, the way the todo list and an exam
 * replace one: the tree is what opens an image, and a row of the tree opens
 * what it names where the last row opened.
 */
export function openImageInFocused(layout: Layout, path: string): Layout {
  return fillFocused(layout, { image: path });
}

/**
 * Show a pdf at its first page in the focused pane, the way `openImageInFocused`
 * shows an image: a row of the tree opens what it names where the last row
 * opened (#361). A followed link takes `openPdfBeside`, the note it was
 * followed from staying on screen.
 *
 * `opened` goes on from the count the pane already holds when it is showing
 * this same pdf, so a second click on the row moves it and the pane turns back
 * to page 1 from wherever the reader scrolled to. `page` is where a search hit
 * in the pdf opens it. Starting it at 1 every time
 * would leave the field unchanged and the pane where it was.
 */
export function openPdfInFocused(layout: Layout, path: string, page?: number): Layout {
  const { pdf } = focusedPane(layout);
  const opened = (pdf?.path === path ? pdf.opened : 0) + 1;

  return fillFocused(layout, { pdf: { path, page, opened } });
}

/**
 * Show an HTML page in the focused pane, the way `openImageInFocused` shows an
 * image. `anchor` is the heading a followed link named, where the page opens.
 */
export function openHtmlInFocused(layout: Layout, path: string, anchor?: string): Layout {
  return fillFocused(layout, { html: path, anchor });
}

/**
 * Put a note's book in a new pane beside it, or go to the one already reading it.
 *
 * Beside, not over. It does not mirror `openTodosInFocused`, which replaces the
 * focused pane whole: a key called "read this book beside this note" must not
 * eat the note.
 *
 * `splitFocused` already makes the empty pane and moves the focus to it, so the
 * new pane's id is the tab's focus by the time this writes the book in.
 */
export function openBookBeside(layout: Layout, note: string): Layout {
  const reading = tabPanes(layout).find((pane) => pane.book === note);
  if (reading) return focusPane(layout, reading.id);

  const split = splitFocused(layout, "row");
  return fillFocused(split, { book: note });
}

/**
 * Put a note's book in the focused pane, or go to the one already reading it.
 *
 * Over the pane, where `openBookBeside` splits: the book finder (#502) picks a
 * book and not a note, so there is no note on screen to keep beside it. The
 * reuse is the same, so a book picked twice is one reader.
 */
export function openBookInFocused(layout: Layout, note: string): Layout {
  const reading = tabPanes(layout).find((pane) => pane.book === note);
  if (reading) return focusPane(layout, reading.id);

  return fillFocused(layout, { book: note });
}

/**
 * Play a note's video in a new pane beside it, or go to the one already playing it.
 *
 * Beside and not over, following `openBookBeside` down to the reuse: watching
 * while writing is the whole point, and a key that ate the note would leave
 * nothing to write in. A second press moves to the player rather than opening a
 * second one, which is what makes the key its own way back.
 */
export function openVideoBeside(layout: Layout, note: string): Layout {
  const playing = tabPanes(layout).find((pane) => pane.video === note);
  if (playing) return focusPane(layout, playing.id);

  // `col` where the reader takes `row`: a book is a column of text and reads
  // beside one, a player is a 16:9 box and the note it belongs to is the thing
  // that wants the width.
  const split = splitFocused(layout, "col");
  return fillFocused(split, { video: note });
}

/**
 * Show a pdf at a page in a pane beside this one, or turn the one showing it.
 *
 * Beside and not over, following `openBookBeside`: the link was followed from
 * a note, and the note stays. Where `openBookBeside` only moves to the reader,
 * this writes the page in too, so a second link to the same pdf turns the pane
 * it is open in rather than opening a second.
 */
export function openPdfBeside(layout: Layout, path: string, page?: number): Layout {
  const showing = tabPanes(layout).find((pane) => pane.pdf?.path === path);
  const split = showing ? focusPane(layout, showing.id) : splitFocused(layout, "row");
  const opened = (showing?.pdf?.opened ?? 0) + 1;

  return fillFocused(split, { pdf: { path, page, opened } });
}

/**
 * Put a note beside this pane, or go to the pane in this tab already holding it.
 *
 * Beside and not over, following `openBookBeside` down to the reuse: a pdf is
 * read against the note it belongs to, and that note stays on screen. The reuse
 * is per tab, a note open in another tab being no pane of this one.
 */
export function openNoteBeside(layout: Layout, path: string): Layout {
  const holding = tabPanes(layout).find((pane) => pane.path === path);
  if (holding) return focusPane(layout, holding.id);

  const split = splitFocused(layout, "row");
  return fillFocused(split, { path });
}

/**
 * Put one person's card in a pane beside this one, or go to the one showing it.
 *
 * Beside and not over, following `openBookBeside` down to the reuse: the card
 * is read next to the note that made you ask about them, and a key that ate
 * that note would leave nothing to read it against. A second press moves to the
 * card rather than opening a second one.
 */
export function openPersonBeside(layout: Layout, person: string): Layout {
  const showing = tabPanes(layout).find((pane) => pane.person === person);
  if (showing) return focusPane(layout, showing.id);

  // `row` the way the reader takes it: a card is a column of short lines and
  // reads beside a note rather than under it.
  const split = splitFocused(layout, "row");
  return fillFocused(split, { person });
}

/**
 * Put a note's history in a pane beside it, or go to the one already listing it.
 *
 * Beside and not over, following `openPersonBeside` down to the reuse: an old
 * version is read against the note as it is now. On a narrow window the route
 * draws the focused pane alone, so there the history takes the screen.
 */
export function openHistoryBeside(layout: Layout, note: string): Layout {
  const listing = tabPanes(layout).find((pane) => pane.history === note);
  if (listing) return focusPane(layout, listing.id);

  const split = splitFocused(layout, "row");
  return fillFocused(split, { history: note });
}

/**
 * Put the graph of the whole vault in the focused pane, replacing whatever was there.
 *
 * Over the pane rather than beside it, following `openTodosInFocused`: the
 * whole vault is not a thing about the note you are in.
 */
export function openGraphInFocused(layout: Layout): Layout {
  return fillFocused(layout, { graph: {} });
}

/**
 * Put the graph around a note in a pane beside it, or go to the one already drawing it.
 *
 * Beside and not over, following `openPersonBeside` down to the reuse: the
 * local graph is read next to the note it is drawn around.
 */
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
 * Open the note a URL names over a restored layout.
 *
 * A pane already holding it, in any tab, is gone to rather than doubled. The
 * focused pane holding it with no line is the plain reload, whose URL the
 * route wrote from that very pane, so the layout comes back as it is. A line
 * is never the reload's, the route writing none into the URL, so it is a link
 * asking for that line and jumps there.
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
 * Rewrite every pane in every tab, which is how a moved note is followed.
 *
 * The panes of tabs that are not on screen are rewritten too: a note that moved
 * moved for all of them. Keep each pane's id, or the tab holding it loses track
 * of what has the focus.
 */
export function mapPanes(layout: Layout, fn: (pane: Pane) => Pane): Layout {
  function walk(node: PaneNode): PaneNode {
    return isSplit(node) ? { ...node, children: node.children.map(walk) } : fn(node);
  }

  return { ...layout, tabs: layout.tabs.map((tab) => ({ ...tab, root: walk(tab.root) })) };
}
