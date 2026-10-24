import { EditorView } from "@codemirror/view";

/**
 * The editor in pane `id` that is on screen, if it has one.
 *
 * A pane whose note is changing keeps the old note's editor on the page for a
 * task, hidden and marked `data-leaving` (note-editor.tsx). While the new note
 * loads that is the only editor the pane has, so a lookup that took the first
 * one would reach the old note. Those are skipped here.
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
