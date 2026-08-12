/**
 * The look a panel over the app wears, in one table.
 *
 * It started with three: the note prompt, the note finder and the note search
 * are the same object seen three ways, a box over the editor, a labelled input
 * at the top, a list under it, and a line at the bottom saying what the list is
 * not saying. They have to read as one thing, and they drifted once already,
 * search growing wider than the finder when its rows gained a path and a line
 * number. Since then the exam pane, the todo pane, the key help and the book's
 * contents have all borrowed part of it, some of them for a footer or a list
 * that is over nothing at all.
 *
 * So take what fits and leave the rest, rather than reading the whole table as
 * one look. Classes and not a component: what the readers do not share is the
 * wiring, each having its own ids, refs, key handling and aria plumbing, and a
 * component taking all of that as props would be longer than the markup it
 * replaced.
 */

/** The dark sheet over the whole window, for a panel that belongs over all of it. */
export const BACKDROP =
  "fixed inset-0 z-20 flex items-start justify-center bg-black/50 pt-[15vh] focus:outline-none";

/** The panel itself, bar its width. Pair with one of the two below. */
export const PANEL =
  "flex flex-col rounded-md border border-one-line bg-one-panel font-mono shadow-xl";

/**
 * The prompt's width: one column, so it needs room for a path and no more.
 *
 * Its height is the content's, capped, because a prompt with three folders
 * under it should not draw a box with nothing in the bottom half.
 */
export const PANEL_NARROW = "max-h-[70vh] w-[min(36rem,90vw)]";

/**
 * The finder's and the search's width: a list and a preview pane side by side.
 *
 * Sized for the wider of the two. A search row carries a path, a line number
 * and the line itself, and the finder is no worse for the room now that its
 * pane renders the note rather than printing it.
 */
export const PANEL_WIDE = "w-[min(72rem,94vw)]";

/** The row holding the label and the input. */
export const HEADER_ROW = "flex items-center gap-3 border-b border-one-line px-3 py-2";

/** The word in the corner saying which overlay this is. */
export const LABEL = "text-[11px] tracking-wider text-one-muted uppercase";

/** The input, which carries no border of its own: the header's is the line. */
export const INPUT = "min-w-0 flex-1 bg-transparent text-[13px] text-one-fg outline-none";

/**
 * The body of a two-column overlay.
 *
 * A fixed height rather than one the content sets, so the panel does not jump
 * about as the list narrows under it.
 */
export const BODY = "flex h-[min(26rem,55vh)]";

/** The list side of a two-column overlay. */
export const LIST = "w-1/2 shrink-0 overflow-auto py-1";

/** The pane beside it, which holds a rendered note and scrolls itself. */
export const PANE = "min-w-0 flex-1 border-l border-one-line text-[12px]";

/** What the pane says when it has no note to show, only a reason. */
export const PANE_MESSAGE = "px-3 py-2 text-one-muted";

/** One row of a list, bar the colours that say whether it is highlighted. */
export const ROW = "w-full cursor-pointer px-3 py-[3px] text-left text-[13px]";

/** The line under the list, which is empty whenever the list speaks for itself. */
export const STATUS = "border-t border-one-line px-3 py-1 text-[11px] text-one-muted";
