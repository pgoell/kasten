import { EditorView } from "@codemirror/view";
import { act, fireEvent } from "@testing-library/react";

/**
 * The table-line-up tests' shared note and helpers, for `table-lineup.test.tsx`
 * and `table-lineup-edges.test.tsx`.
 */

/** A table with a short cell in its last row, and a line after it for the cursor to go to. */
export const DOC = ["| a | longer |", "| - | - |", "| xx | b |", "", "after"].join("\n");
/** DOC with `c` typed after the `b`, the table not yet lined up. */
export const TYPED = DOC.replace("| xx | b |", "| xx | bc |");
/** TYPED lined up, which is what the line-up writes. */
export const LINED = ["| a   | longer |", "| --- | ------ |", "| xx  | bc     |", "", "after"].join(
  "\n",
);

export function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

export function content(container: HTMLElement): HTMLElement {
  return container.querySelector(".cm-content") as HTMLElement;
}

/** Puts the cursor where a click or a motion would. */
export function cursorTo(view: EditorView, at: number): void {
  act(() => view.dispatch({ selection: { anchor: at } }));
}

/** Types `text` at `at` as the keyboard does, and leaves the cursor after it. */
export function typeAt(view: EditorView, at: number, text: string): void {
  act(() =>
    view.dispatch({
      changes: { from: at, insert: text },
      selection: { anchor: at + text.length },
      userEvent: "input.type",
    }),
  );
}

/** Ctrl+s, which is the save key with vim on or off. */
export function saveWithCtrlS(container: HTMLElement): void {
  fireEvent.keyDown(content(container), { key: "s", ctrlKey: true });
}
