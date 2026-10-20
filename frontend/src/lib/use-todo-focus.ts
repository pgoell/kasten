import { type RefObject, useCallback, useEffect, useRef } from "react";
import { nameAt } from "@/lib/todo";

/**
 * Where the focus of a todo pane lives: on the pane while it has no row, on the
 * cursor's row once it has one, and on an input while a row is being typed in.
 * `held` says whether the keys are the pane's, so a redraw can hand them back.
 */
export function useTodoFocus(o: {
  panel: RefObject<HTMLElement | null>;
  filter: RefObject<HTMLInputElement | null>;
  draft: RefObject<HTMLInputElement | null>;
  focusSignal: number;
  cursorKey: string;
  rows: unknown[];
  board: boolean;
  editingKey: string | undefined;
}) {
  const { panel, filter, draft, focusSignal, cursorKey, rows, board, editingKey } = o;
  /** Whether the keys are ours, so a row that leaves can hand them back. */
  const held = useRef(false);

  /**
   * Hand the focus back to the list, which is where the keys below act.
   *
   * Wrapped because an effect calls it too, and it reads nothing but refs, so
   * one instance stands for the life of the pane.
   */
  const focusList = useCallback(() => {
    const element = panel.current;
    // The section when there is no row to land on, so the keys still reach it.
    (element?.querySelector<HTMLElement>('[tabindex="0"]') ?? element)?.focus();
  }, [panel]);

  // Arriving from another pane, which unmounted whatever held the focus, so
  // nothing but this can take it. The section rather than a row: the rows come
  // with the query a render later, and the effect below moves the focus onto
  // one the moment they do. It is also the only thing left to focus when there
  // is nothing to do, and `q` has to work on an empty list.
  //
  // Unlike `file-explorer.tsx`, which guards its first render, this pane mounts
  // when it is moved to, so its first render is the arrival.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal, panel]);

  // Only when the keys are already ours, and never while the filter holds them:
  // typing narrows the list, which moves the cursor, and following it would
  // pull the focus out of the input mid-word.
  //
  // `dropped` is the case `contains` cannot see. `x` writes, the list is asked
  // again, and the row the cursor was on leaves it. The browser hands the focus
  // to the body rather than to whatever replaced the row, so without this the
  // first thing you tick off leaves the pane deaf to every key after it.
  //
  // On the rows as well as on the cursor, because a redraw can unmount the row
  // the focus is on without moving the cursor off it: an edit that gives a todo
  // a date moves its row to another group, which is a different element for the
  // same `path:line`.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` is the trigger and not a value this reads. That the list redrew is exactly what says the row holding the focus may be gone.
  useEffect(() => {
    const element = panel.current;
    // The board keeps its own cursor, and its own copy of this.
    if (!element || board) return;
    const dropped = held.current && document.activeElement === document.body;
    if (!dropped && !element.contains(document.activeElement)) return;
    // An input holding the keys keeps them. Both are typed into while the list
    // under them can move: the filter narrows it, and the vault can answer
    // mid-edit.
    if (document.activeElement === filter.current) return;
    if (document.activeElement === draft.current) return;
    (element.querySelector<HTMLElement>(`[data-row="${cursorKey}"]`) ?? element).focus();
  }, [cursorKey, rows, board, panel, filter, draft]);

  // The row has just become an input, so the keys go to it rather than to the
  // list the row was a row of, and back to the row when it is a row again.
  //
  // Here rather than in the key that closes it, because at the press the input
  // is still what is drawn: the row it goes back to does not exist until this
  // render. Off `held` rather than off what has the focus, for the reason the
  // effect above reads `dropped`: an input that unmounts fires no blur, so the
  // browser has already left the focus on the body by now. Only when the keys
  // were ours, so a mount cannot take them from another pane.
  useEffect(() => {
    if (editingKey === undefined) {
      if (held.current) focusList();
      return;
    }

    draft.current?.focus();
    // At the end rather than over the whole line: an edit starts on a line that
    // is already right in the middle, and one keystroke onto a selected line
    // would wipe it. A waiting line that names nobody is the exception: the
    // name is what is missing, and it goes mid-line, after the `👤` and its
    // date.
    const value = draft.current?.value ?? "";
    const at = nameAt(value) ?? value.length;
    draft.current?.setSelectionRange(at, at);
  }, [editingKey, focusList, draft]);

  return { held, focusList };
}
