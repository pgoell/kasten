import { type RefObject, useCallback, useEffect, useRef } from "react";
import { nameAt } from "@/lib/todo/todo";

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

  // Arriving from another pane leaves the focus on nothing, so take it here.
  // The section, not a row: rows come a render later, and the effect below moves onto one.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal, panel]);

  // Only while the keys are ours and no input holds them, so the focus stays put mid-word.
  // `dropped`: `x` removes the cursor's row, and the focus falls to the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` is the trigger and not a value this reads. That the list redrew is exactly what says the row holding the focus may be gone.
  useEffect(() => {
    const element = panel.current;
    // The board keeps its own cursor, and its own copy of this.
    if (!element || board) return;
    const dropped = held.current && document.activeElement === document.body;
    if (!dropped && !element.contains(document.activeElement)) return;
    if (document.activeElement === filter.current) return;
    if (document.activeElement === draft.current) return;
    (element.querySelector<HTMLElement>(`[data-row="${cursorKey}"]`) ?? element).focus();
  }, [cursorKey, rows, board, panel, filter, draft]);

  // Off `held`, not the focus: an unmounting input fires no blur. Only when the keys were ours.
  useEffect(() => {
    if (editingKey === undefined) {
      if (held.current) focusList();
      return;
    }

    draft.current?.focus();
    // Cursor at the end, not a selection: one keystroke over a selected line would wipe it.
    // A waiting line that names nobody is the exception: the name goes mid-line, after the date.
    const value = draft.current?.value ?? "";
    const at = nameAt(value) ?? value.length;
    draft.current?.setSelectionRange(at, at);
  }, [editingKey, focusList, draft]);

  return { held, focusList };
}
