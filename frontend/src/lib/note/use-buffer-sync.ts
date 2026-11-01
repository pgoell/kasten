import { Transaction } from "@codemirror/state";
import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { fetchNote } from "@/lib/api";
import { heldText, sameText, useHeld } from "@/lib/held-text";
import type { useAutosave } from "@/lib/note/use-autosave";
import { viewCommands } from "@/lib/palette";
import { docIn, paneView } from "@/lib/pane-doc";
import { type Layout, tabPanes } from "@/lib/panes";

type Autosave = ReturnType<typeof useAutosave>;

export type BufferSync = ReturnType<typeof useBufferSync>;

/** Puts `vault` into every pane but `paneId` that shows `note` with other text, off the undo stack. */
function showVault(layout: Layout, paneId: string, note: string, vault: string): void {
  for (const shown of tabPanes(layout)) {
    if (shown.id === paneId || shown.path !== note) continue;
    const view = paneView(shown.id);
    if (!view || view.state.doc.toString() === vault) continue;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: vault },
      annotations: Transaction.addToHistory.of(false),
    });
  }
}

/**
 * How the focused editor's buffer meets the vault: the text the vault refused
 * to take, the reloads an unfocused pane is allowed, and the conflict's diff.
 */
export function useBufferSync({
  autosave,
  paneId,
  path,
  layoutNow,
  refuse,
}: {
  autosave: Pick<Autosave, "status" | "change" | "isConflicted" | "isWriting" | "revert">;
  paneId: string;
  path: string | undefined;
  layoutNow: RefObject<Layout>;
  refuse: () => null;
}) {
  const { status, change, isConflicted, isWriting, revert } = autosave;
  const queryClient = useQueryClient();

  // Refuses only in a pane showing the note's held text, which a reload would replace with the vault's text.
  // Any other pane on the note takes the write, or one keystroke would write its old text back over the new.
  const standby = useRef(new Map<string, (text: string) => boolean>());
  const standbyReload = (id: string) => {
    let call = standby.current.get(id);
    if (!call) {
      call = (text) => {
        const at = tabPanes(layoutNow.current).find((each) => each.id === id)?.path;
        // Only an entry of the note `text` is: another note's never refuses.
        const entry = at === undefined ? undefined : heldText(at, text);
        const doc = docIn(id);
        return !(entry !== undefined && doc !== undefined && sameText(doc, entry.content));
      };
      standby.current.set(id, call);
    }
    return call;
  };
  // Text the vault refused, by note: read here so the bar redraws when one is held or let go.
  const held = useHeld();
  // A conflicted note's cache holds pre-conflict text, which a reopen would take for the vault's.
  // Dropped unless a visible pane reads it.
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    for (const each of held) {
      const query = each.conflicted ? cache.find({ queryKey: ["note", each.path] }) : undefined;
      if (query && query.getObserversCount() === 0) cache.remove(query);
    }
  }, [held, queryClient]);
  // A pane left on held text refused reloads while it was held. Once settled elsewhere, no reload comes,
  // so the vault's text goes into the view here, off the undo stack so `u` cannot bring the old text back.
  const heldBefore = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(held.map((each) => each.path));
    for (const each of heldBefore.current) {
      const vault = queryClient.getQueryData<string>(["note", each]);
      if (now.has(each) || vault === undefined) continue;
      showVault(layoutNow.current, paneId, each, vault);
    }
    heldBefore.current = now;
  }, [held, queryClient, paneId, layoutNow]);
  // The vault's side of a conflict, for the diff only: the cache holds text from before the other write.
  // A failed read leaves the diff out, and the buttons still settle the conflict.
  const [vaultSide, setVaultSide] = useState<{ path: string; text: string }>();
  // Raised per keystroke while conflicted, so the bar's diff redraws: nothing else would redraw it on typing.
  // Only then, so typing elsewhere does not redraw the route.
  const [, setMerged] = useState(0);
  // Raised for each write the stream declined to reload, and each while conflicted (#269). Without it the diff
  // stays on the first outside write, and a merge made from it would overwrite a write the reader never saw.
  const [declined, setDeclined] = useState(0);
  const decline = useCallback(() => setDeclined((previous) => previous + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `declined` is the trigger, and is not read.
  useEffect(() => {
    if (status !== "conflict" || path === undefined) return;
    let live = true;
    fetchNote(path).then(
      (text) => {
        if (live) setVaultSide({ path, text });
      },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error;
        if (live) setVaultSide(undefined);
      },
    );
    return () => {
      live = false;
    };
  }, [status, path, declined]);
  const typed = useCallback(
    (doc: string) => {
      change(doc);
      if (isConflicted()) setMerged((previous) => previous + 1);
    },
    [change, isConflicted],
  );
  // The read made at the conflict, for this note only: one left for another note is not this note's side.
  const conflict = () => {
    const mine = docIn(paneId);
    return vaultSide !== undefined && vaultSide.path === path && mine !== undefined
      ? { vault: vaultSide.text, mine }
      : undefined;
  };

  /**
   * Read the open note off the vault for `:e`, answering with its text or null when refused. The vault, not the cache,
   * which holds text from before the write that changed the note. The discard waits on the read.
   */
  const reload = useCallback(
    async (force: boolean): Promise<string | null> => {
      if (path === undefined) return null;
      // Before the read: the read fills the cache, which a clean buffer takes even on refusal (#291).
      if (!force && isWriting(path)) return refuse();

      const text = await queryClient.fetchQuery({
        queryKey: ["note", path],
        queryFn: () => fetchNote(path),
        // Fresh for ten seconds by default, but `:e` wants what the vault holds now.
        staleTime: 0,
      });
      // A refusal here is `:e` on edits: the bar flashes rather than staying silent.
      return revert(force) ? text : refuse();
    },
    [path, queryClient, revert, refuse, isWriting],
  );

  /**
   * `:e!` for the status bar's button, which has no view. Goes through the focused editor, since only the editor
   * puts text on screen: after a refused reload the cache already holds the vault's text.
   */
  const takeVault = useCallback(() => {
    const view = paneView(paneId);
    if (view) view.state.facet(viewCommands)?.reload(view, true);
  }, [paneId]);

  return { held, standbyReload, typed, reload, takeVault, conflict, decline };
}
