import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { fetchNote } from "@/lib/api";
import { heldText, sameText, useHeld } from "@/lib/held-text";
import { viewCommands } from "@/lib/palette";
import { docIn, paneEditor } from "@/lib/pane-doc";
import { type Layout, tabPanes } from "@/lib/panes";
import type { useAutosave } from "@/lib/use-autosave";

type Autosave = ReturnType<typeof useAutosave>;

export type BufferSync = ReturnType<typeof useBufferSync>;

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

  // What an unfocused pane's editor asks before it takes the vault's text.
  // It refuses only in a pane showing the text held for its note, conflicted
  // or not: that pane is where the reader left it, or a restore opened it on
  // that text, and a reload would put the vault's text there in its place, so
  // coming back would find nothing to restore and read "Saved" over text the
  // vault never took.
  // A pane on that note that never showed the held text takes the write, or
  // it would sit on an old text that one keystroke writes back over the new.
  // One callback per pane, kept, so the editor's memo is not broken by a new
  // arrow each render.
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
  // Text the vault refused, kept by note. Read here so a note held or let go
  // re-renders the bar, and the focused editor opens on its held text.
  const held = useHeld();
  // A note left standing conflicted has the text from before the other write
  // in the cache: the reload of it was declined while the reader's text was on
  // screen. Kept, a reopen would draw that first and take it for the vault's,
  // so the diff would be against text nobody holds and a vault that came to
  // hold the kept text would still read as a conflict. Dropped only where no
  // pane reads it, the one reading it being a pane the reader can still see.
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    for (const each of held) {
      const query = each.conflicted ? cache.find({ queryKey: ["note", each.path] }) : undefined;
      if (query && query.getObserversCount() === 0) cache.remove(query);
    }
  }, [held, queryClient]);
  // A pane left showing held text refused every reload while it was held
  // (`standbyReload`), conflicted or not: a restore opens every pane on a
  // held note on that text. Once it is settled or thrown away elsewhere, the
  // vault's text may already be in the cache, so no reload comes, and the
  // pane would keep text the reader threw away for one keystroke to write over
  // the vault. Put straight into the view: an unfocused pane reports no
  // typing, and off the undo stack so `u` there cannot bring it back.
  const heldBefore = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(held.map((each) => each.path));
    for (const each of heldBefore.current) {
      const vault = queryClient.getQueryData<string>(["note", each]);
      if (now.has(each) || vault === undefined) continue;
      for (const shown of tabPanes(layoutNow.current)) {
        if (shown.id === paneId || shown.path !== each) continue;
        const editor = paneEditor(shown.id);
        const view = editor && EditorView.findFromDOM(editor);
        if (!view || view.state.doc.toString() === vault) continue;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: vault },
          annotations: Transaction.addToHistory.of(false),
        });
      }
    }
    heldBefore.current = now;
  }, [held, queryClient, paneId, layoutNow]);
  // The vault's side of a conflict, read for the bar's diff alone. Not the
  // cache: a conflict the stream raised declined the reload, so the cache
  // holds the text from before the other write. Read apart from the note's
  // query so the editor is not handed it. A failed read leaves the diff out,
  // and the buttons under it still settle the conflict.
  const [vaultSide, setVaultSide] = useState<{ path: string; text: string }>();
  // Raised on each keystroke while the note stands conflicted, for the bar's
  // diff alone: typing then changes no reading, so nothing else would draw the
  // bar again, and a reader merging by hand would be shown the text they began
  // from. Only then, so a keystroke anywhere else does not redraw the route.
  const [, setMerged] = useState(0);
  // Raised by the stream for each write to the focused note it declined to
  // reload, and for each while the note stands conflicted, which is reloaded
  // in case the vault came to hold the buffer's text (#269). A second outside
  // write keeps the status at "conflict", and without this the diff would
  // stay on the first: a merge made from it, then `:w`, would put the
  // reader's text over a write they were never shown.
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
  // The read made when the conflict was raised, and only for the note it
  // was read for: one left behind for another is not this one's side.
  const conflict = () => {
    const mine = docIn(paneId);
    return vaultSide !== undefined && vaultSide.path === path && mine !== undefined
      ? { vault: vaultSide.text, mine }
      : undefined;
  };

  /**
   * Read the open note off the vault again and answer with its text, `:e`.
   *
   * The other way out of a conflict, `:w` being the one that keeps the buffer.
   * Null back is the refusal `:e` gets on a buffer holding unsaved text.
   *
   * The vault and not the cache: a note that changed under unsaved text is a
   * note this route deliberately did not read again, so what is cached is the
   * text from before that write, which is neither of the two versions in play.
   * `fetchQuery` fills the cache on the way through, so reopening the note
   * reads back what the buffer is about to hold.
   *
   * The discard waits on the read rather than leading it. The other order drops
   * the reader's only copy on the strength of a request that may never land.
   */
  const reload = useCallback(
    async (force: boolean): Promise<string | null> => {
      if (path === undefined) return null;
      // Before the read and not after: the read fills the cache, and a clean
      // buffer takes what the cache holds, so a refusal after it would still
      // put the vault's older text on screen under a save on its way (#291).
      if (!force && isWriting(path)) return refuse();

      const text = await queryClient.fetchQuery({
        queryKey: ["note", path],
        queryFn: () => fetchNote(path),
        // A note counts as fresh for ten seconds here, and `:e` asked for what
        // the vault holds rather than for whatever that window still has.
        staleTime: 0,
      });
      // A no here is `:e` on a buffer holding edits, and the bar is flashed
      // rather than left saying nothing about a command that did nothing.
      return revert(force) ? text : refuse();
    },
    [path, queryClient, revert, refuse, isWriting],
  );

  /**
   * `:e!` for the status bar's button, which has no view to run it in.
   *
   * Through the focused pane's editor and not `reload` alone: `reload` answers
   * with the vault's text and the editor is who puts it on screen. The cache
   * cannot carry it there, holding that same text already whenever the conflict
   * was raised by a reload the editor refused.
   */
  const takeVault = useCallback(() => {
    const editor = paneEditor(paneId);
    const view = editor && EditorView.findFromDOM(editor);
    if (view) view.state.facet(viewCommands)?.reload(view, true);
  }, [paneId]);

  return { held, standbyReload, typed, reload, takeVault, conflict, decline };
}
