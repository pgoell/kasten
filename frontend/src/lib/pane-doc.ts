import { EditorView } from "@codemirror/view";

/**
 * The on-screen editor in pane `id`, skipping the old note's `data-leaving` copy
 * that the pane keeps while a new note loads.
 */
export function paneEditor(id: string): HTMLElement | null {
  const editors = document.querySelectorAll<HTMLElement>(`[data-pane="${id}"] .cm-editor`);
  return [...editors].find((editor) => editor.closest("[data-leaving]") === null) ?? null;
}

/** The document of the editor in pane `id` as it stands on screen, if it holds one. */
export function docIn(id: string): string | undefined {
  const editor = paneEditor(id);
  return editor ? EditorView.findFromDOM(editor)?.state.doc.toString() : undefined;
}
