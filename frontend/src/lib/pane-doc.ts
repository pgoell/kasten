import { EditorView } from "@codemirror/view";

/** The document of the editor in pane `id` as it stands on screen, if it holds one. */
export function docIn(id: string): string | undefined {
  const editor = document.querySelector<HTMLElement>(`[data-pane="${id}"] .cm-editor`);
  return editor ? EditorView.findFromDOM(editor)?.state.doc.toString() : undefined;
}
