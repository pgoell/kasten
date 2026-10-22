import { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { openFoodSearch } from "@/lib/log-card";

/**
 * The editor the pane holds, found by the pane and not the focus: the palette's
 * lookup finds no view while the focus sits off the editor, as `logDrink` notes.
 */
export function paneView(id: string): EditorView | null {
  const editor = document.querySelector<HTMLElement>(`[data-pane="${id}"] .cm-editor`);
  return editor ? EditorView.findFromDOM(editor) : null;
}

/**
 * Log food's wait for today's note: armed when the food is logged, and searched
 * once the note is on screen in the pane it was opened in.
 */
export function useFoodWait(paneId: string, panePath: string | undefined) {
  const queryClient = useQueryClient();
  /** Today's note path while `logFood` waits; cleared on a pane change or a failed load. */
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const target = pending.current;
    pending.current = null;
    if (target === null || panePath !== target) return;
    // Tried once, when the editor is in the pane, and then the watch ends whether
    // or not the card showed, so typing into the note later never opens it.
    const attach = () => {
      const view = paneView(paneId);
      if (view !== null) openFoodSearch(view);
      return view !== null;
    };
    const settled = () =>
      attach() || queryClient.getQueryState(["note", target])?.status === "error";
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
      arm: (path: string) => {
        pending.current = path;
      },
      cancel: () => {
        pending.current = null;
      },
    }),
    [],
  );
}
