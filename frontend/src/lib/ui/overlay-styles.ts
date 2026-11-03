/**
 * The look of a panel over the app. Readers take the classes they need; wiring stays theirs.
 */

/**
 * The dark sheet over the window. Padded at the foot for an on-screen keyboard, and at the sides
 * for a phone's notch: 90vw would leave less than the 47px notch takes (#355).
 */
export const BACKDROP =
  "fixed inset-0 z-20 flex items-start justify-center bg-black/50 pt-[15vh] pr-[env(safe-area-inset-right)] pb-[max(var(--keyboard,0px),env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] focus:outline-none";

/** The sheet the press now under way began on, if it began on one. */
let pressed: EventTarget | null = null;
/** Whether that press was let go on the same sheet. */
let released = false;

/**
 * Closes on a press and release on the sheet itself. Acts on the click, not the press, so the
 * release never reaches what lies under. Spread onto the sheet. `holding` keeps a draft.
 */
export function closeOnBackdrop(onClose: () => void, holding = false) {
  type Press = { target: EventTarget; currentTarget: EventTarget };
  return {
    onMouseDown: (event: Press) => {
      pressed = event.target === event.currentTarget ? event.currentTarget : null;
    },
    onMouseUp: (event: Press) => {
      released = event.target === event.currentTarget;
    },
    onClick: (event: Press) => {
      const outside = pressed === event.currentTarget && released;
      pressed = null;
      released = false;
      if (holding || event.target !== event.currentTarget) return;
      if (outside) onClose();
    },
  };
}

/** The panel itself, bar its width. Pair with one of the two below. */
export const PANEL = "flex flex-col rounded-md border border-k-rule bg-k-paper font-mono shadow-xl";

/** The prompt's width: one column, with height following the content up to a cap. */
export const PANEL_NARROW = "max-h-[min(70vh,100%)] w-[min(36rem,90vw)]";

/** The finder's and search's width: a list beside a preview, sized for a search row. */
export const PANEL_WIDE = "max-h-full w-[min(72rem,94vw)]";

/** The row holding the label and the input, 44px under a finger like any other target. */
export const HEADER_ROW =
  "flex items-center gap-3 border-b border-k-rule px-3 py-2 pointer-coarse:min-h-11";

/** The word in the corner saying which overlay this is. */
export const LABEL = "text-[11px] tracking-wider text-k-muted uppercase";

/** 16px on touch: Safari zooms into a smaller input and does not zoom back out. */
export const INPUT =
  "min-w-0 flex-1 bg-transparent text-[13px] text-k-ink outline-none pointer-coarse:text-base";

/**
 * A fixed height, so the panel does not jump as the list narrows.
 * Gives way only on a phone with its keyboard up.
 */
export const BODY = "flex h-[min(26rem,55vh)] min-h-0";

/** The list side: full width below `md`, where half a phone is too narrow for a path. */
export const LIST = "w-full shrink-0 overflow-auto py-1 md:w-1/2";

/** The pane beside the list. Its readers skip it below `md`, else each row mounts an editor. */
export const PANE = "min-w-0 flex-1 border-l border-k-rule text-[12px]";

/** What the pane says when it has no note to show, only a reason. */
export const PANE_MESSAGE = "px-3 py-2 text-k-muted";

/** One list row, bar the highlight colours. */
// `k-row` takes a press as a tint rather than a shrink; see `app.css`.
export const ROW = "k-row w-full cursor-pointer px-3 py-[3px] text-left text-[13px]";

/**
 * The height a finger needs. Apart from `ROW`, so a row only the keyboard reaches stays short.
 */
export const TAP = "pointer-coarse:min-h-11 pointer-coarse:items-center";

/** The line under the list, which is empty whenever the list speaks for itself. */
export const STATUS = "border-t border-k-rule px-3 py-1 text-[11px] text-k-muted";
