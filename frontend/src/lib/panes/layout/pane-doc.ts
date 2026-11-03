import { EditorView } from "@codemirror/view";

/**
 * The on-screen editor in pane `id`, skipping the old note's `data-leaving` copy
 * that the pane keeps while a new note loads.
 */
function paneEditor(id: string): HTMLElement | null {
  const editors = document.querySelectorAll<HTMLElement>(`[data-pane="${id}"] .cm-editor`);
  return [...editors].find((editor) => editor.closest("[data-leaving]") === null) ?? null;
}

/**
 * The editor the pane holds, found by the pane and not the focus: the palette's
 * lookup finds no view while the focus sits off the editor.
 */
export function paneView(id: string): EditorView | null {
  const editor = paneEditor(id);
  return editor ? EditorView.findFromDOM(editor) : null;
}

/** The document of the editor in pane `id` as it stands on screen, if it holds one. */
export function docIn(id: string): string | undefined {
  return paneView(id)?.state.doc.toString();
}
