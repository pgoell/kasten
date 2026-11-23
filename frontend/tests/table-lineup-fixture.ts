import { EditorView } from "@codemirror/view";
import { act } from "@testing-library/react";

/** Editor helpers for `editor-save-and-undo.test.tsx`. */

export function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

export function content(container: HTMLElement): HTMLElement {
  return container.querySelector(".cm-content") as HTMLElement;
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
