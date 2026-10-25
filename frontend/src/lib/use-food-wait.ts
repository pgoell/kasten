import { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { paneEditor } from "@/lib/pane-doc";

/**
 * The editor the pane holds, found by the pane and not the focus: the palette's
 * lookup finds no view while the focus sits off the editor, as `logDrink` notes.
 */
export function paneView(id: string): EditorView | null {
  const editor = paneEditor(id);
  return editor ? EditorView.findFromDOM(editor) : null;
}

/**
 * The palette's log wait for today's note: armed by a command that needs today's note
 * open first (`Log food` opens the search, `Log weight` asks on the card), and run
 * once the note is on screen in the pane it was opened in.
 */
export function useFoodWait(paneId: string, panePath: string | undefined) {
  const queryClient = useQueryClient();
  /** Today's note path and what to do there, while a command waits; cleared on a pane change or a failed load. */
  const pending = useRef<{ path: string; then: (view: EditorView) => void } | null>(null);
  useEffect(() => {
    const target = pending.current;
    pending.current = null;
    if (target === null || panePath !== target.path) return;
    // Tried once, when the editor is in the pane, and then the watch ends whether
    // or not the card showed, so typing into the note later never opens it.
    const attach = () => {
      const view = paneView(paneId);
      if (view !== null) target.then(view);
      return view !== null;
    };
    const settled = () =>
      attach() || queryClient.getQueryState(["note", target.path])?.status === "error";
    if (settled()) return;
    // The editor mounts after the path is taken, so wait for it to appear.
    const element = document.querySelector<HTMLElement>(`[data-pane="${paneId}"]`);
    if (element === null) return;
    const observer = new MutationObserver(() => {
      if (settled()) observer.disconnect();
    });
    // The error text replaces the loading text in place, which only characterData sees.
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [paneId, panePath, queryClient]);

  return useMemo(
    () => ({
      arm: (path: string, then: (view: EditorView) => void) => {
        pending.current = { path, then };
      },
      cancel: () => {
        pending.current = null;
      },
    }),
    [],
  );
}
