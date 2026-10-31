import type { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { heldText } from "@/lib/held-text";
import type { TreeCommands } from "@/lib/key-bindings";
import { askOnCard, openFoodSearch } from "@/lib/log/log-card";
import { drinkTarget, logDrinkInVault, logDrinkInView } from "@/lib/log/log-write";
import { paneView } from "@/lib/pane-doc";
import type { Pane } from "@/lib/panes";
import { type Period, periodicNote } from "@/lib/periodic";

/**
 * The palette's log wait for today's note: armed by a command that needs today's note
 * open first (`Log food` opens the search, `Log weight` asks on the card), and run
 * once the note is on screen in the pane it was opened in.
 */
function useFoodWait(paneId: string, panePath: string | undefined) {
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

/**
 * The commands that write into today's daily note. Nothing here moves a pane, so it takes
 * `saveFirst` and `openPeriodic` but no `moveTo`.
 */
export function useLogCommands({
  pane,
  saveFirst,
  openPeriodic,
  setNotice,
  paths,
  focusedNote,
}: {
  pane: Pick<Pane, "id" | "path">;
  saveFirst: () => Promise<boolean>;
  openPeriodic: (period: Period) => boolean | Promise<boolean> | undefined;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
  /** The vault's note paths, as the listing holds them; undefined until it loads. */
  paths: string[] | undefined;
  /** The note the focused pane holds, and whether a save of one is in the air. */
  focusedNote: RefObject<{ path: string | undefined; isWriting: (note: string) => boolean }>;
}) {
  const food = useFoodWait(pane.id, pane.path);

  return useMemo<Pick<TreeCommands, "logDrink" | "logFood" | "logWeight">>(
    () => ({
      // The notice names the line without its list dash, or why the vault refused.
      logDrink: (line) => {
        setNotice(undefined);
        const today = periodicNote("daily", new Date()).path;
        const target = drinkTarget({
          today,
          focusedPath: pane.path,
          held: heldText(today) !== undefined,
          writing: focusedNote.current.isWriting(today),
        });
        // Found by pane, not focus: focus on the body, toolbar or a card finds no view,
        // and the vault write would land under the open note.
        if (target === "buffer") {
          const view = paneView(pane.id);
          if (view === null || !logDrinkInView(view, line)) {
            setNotice(`Nothing logged: ${today} is not open to type in`);
          }
          return;
        }
        if (typeof target === "object") {
          setNotice(`Nothing logged: ${target.why}`);
          return;
        }
        // Asked again when the queue reaches the write, since a save may have run first.
        const stillOk = () => {
          const now = drinkTarget({
            today,
            focusedPath: focusedNote.current.path,
            held: heldText(today) !== undefined,
            writing: focusedNote.current.isWriting(today),
          });
          if (now === "vault") return null;
          return { why: typeof now === "object" ? now.why : `${today} is open to type in` };
        };
        void logDrinkInVault(line, paths ?? [], stillOk).then(
          () => setNotice(`Logged ${line.slice(2)} into today's note`),
          (error: unknown) =>
            setNotice(error instanceof Error ? error.message : "The drink was not logged"),
        );
      },
      // Searched in place when today's note is open. Otherwise openPeriodic makes it, and
      // useFoodWait holds the search until it is on screen.
      logFood: async () => {
        const today = periodicNote("daily", new Date()).path;
        if (pane.path === today) {
          const view = paneView(pane.id);
          if (view !== null) openFoodSearch(view);
          return;
        }
        // Saved first: a refused save leaves nothing waiting.
        if (!(await saveFirst())) return;
        food.arm(today, (view) => openFoodSearch(view));
        // A failed create or open leaves nothing waiting, so a later `<leader>gd` is not searched.
        if (!(await openPeriodic("daily"))) food.cancel();
      },
      logWeight: async (mark) => {
        const today = periodicNote("daily", new Date()).path;
        if (pane.path === today) {
          const view = paneView(pane.id);
          if (view !== null) askOnCard(view, mark);
          return;
        }
        if (!(await saveFirst())) return;
        food.arm(today, (view) => askOnCard(view, mark));
        if (!(await openPeriodic("daily"))) food.cancel();
      },
    }),
    [pane.id, pane.path, saveFirst, openPeriodic, setNotice, paths, focusedNote, food],
  );
}
