import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Held, holdText } from "@/lib/held-text";
import { type Buffer, forgetAloft, useHeldBuffer } from "@/lib/note/held-buffer";
import { forgetWrites, heldAt, resendLeft, saves, visit, writing } from "@/lib/note/save-queue";
import { useBufferWrite } from "@/lib/note/use-buffer-write";
import { useVaultReads } from "@/lib/note/vault-reads";

/** Long enough that a sentence is one write, short enough to forget about. */
const QUIET_MS = 800;

/**
 * A note left with a failed write has no reading of its own here: its text is
 * held (`held-text.ts`) and the bar lists it beside whatever note is open.
 */
export type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "conflict";

/** Forget every write of the page, as a new page starts with none. For tests. */
export function forgetQueues(): void {
  forgetWrites();
  forgetAloft();
}

/**
 * Writes one note back to the vault as it is edited.
 *
 * Text goes out once the typing stops, or at once on `save()`. Nothing is
 * written until the document changes, so opening a note never touches disk,
 * and nothing is written at all while no note is open.
 *
 * Every write names its base, the vault's text under the buffer, and the vault
 * refuses one it has moved past. That refusal is the only conflict check: the
 * client guesses nothing about whose write an event was. A refused note stops
 * the automatic write, and the reader breaks the tie with `:w`.
 *
 * `shown` reads the document the focused editor has on screen, or undefined
 * when there is none. See the effect run on each opening.
 *
 * `pane` names the focused pane. One hook follows whichever pane has the
 * focus, and two panes on one note hold two buffers: a move between them is
 * a leave and an opening, as a move to another note is, or the second pane's
 * typing would replace the first's text in `pending` and drop held text the
 * first showed as written.
 */
export function useAutosave(
  path: string | undefined,
  shown?: () => string | undefined,
  pane?: string,
) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const openRef = useRef(path);
  openRef.current = path;
  // What the vault answered the failed write with, kept for the bar to show on
  // hover. `error` says a write did not land; only this says whether that was
  // the proxy, the disk or a bad path, which is what decides the next move.
  const [reason, setReason] = useState<string | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDisk = useRef<string | null>(null);
  const conflicted = useRef(false);
  const reverts = useRef(0);
  const taken = useRef<Held | null>(null);
  const [restored, setRestored] = useState<Held | null>(null);
  const take = useCallback((entry: Held | null) => {
    taken.current = entry;
    setRestored(entry);
  }, []);
  const opening = useRef(true);
  const offered = useRef<Held | undefined>(undefined);
  const queryClient = useQueryClient();

  /**
   * The vault's text under the buffer of `note`, the note open now: what this
   * visit last learned is on disk, the cache otherwise. Not the cache alone,
   * which a write is kept out of while typing went on through it.
   */
  const lastBase = useCallback(
    (note: string) => onDisk.current ?? queryClient.getQueryData<string>(["note", note]),
    [queryClient],
  );

  const buffer = useMemo<Buffer>(
    () => ({
      pending,
      timer,
      onDisk,
      conflicted,
      reverts,
      taken,
      opening,
      offered,
      shownRef,
      openRef,
      take,
      setStatus,
      setReason,
      queryClient,
      lastBase,
    }),
    [take, queryClient, lastBase],
  );
  // Effect order follows hook call order, and React runs cleanups in declaration
  // order. The unmount hold in `useHeldBuffer` goes first, before the leave
  // flush, which empties `pending`; the leave flush then goes before the hide.
  const { takeFailed, follow, holdOwn } = useHeldBuffer(buffer);
  const { write, save, saveFirst, revert } = useBufferWrite(buffer, path, takeFailed);

  /**
   * Whether the vault has moved past the buffer, for the keys that must refuse.
   *
   * A reading off the ref rather than off `status`: everything the route builds
   * out of this would take `status` into its dependencies, and one of those is
   * the command table the editor's memo is keyed on.
   */
  const isConflicted = useCallback(() => conflicted.current, []);

  /**
   * Whether text for `note` is already on its way to the vault.
   *
   * The map alone, and no reading of `pending`: pending text belongs to the note
   * this hook follows, and the route's own first guard already refuses that note
   * by name, so a clause here would be a second answer to a question already
   * answered.
   */
  const isWriting = useCallback((note: string) => writing.current.has(note), []);

  const change = useCallback(
    (doc: string) => {
      pending.current = doc;
      // Typing settles nothing while the note stands conflicted: the vault
      // still holds text this buffer never saw, and reading `unsaved` would
      // promise a write the timer below no longer makes.
      if (!conflicted.current) setStatus("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!conflicted.current) void save();
      }, QUIET_MS);
    },
    [save],
  );

  // React runs a cleanup with the render's own closure, so opening another
  // note writes what is pending to the note it was typed into, not to the one
  // that just replaced it. Unmounting flushes for the same reason. Nobody is
  // left to hear how the write went, so the promise is dropped on purpose.
  //
  // A conflicted note is held and not written, the way the hide below holds
  // it: flushing would put the reader's text over the other writer's with
  // nobody asked, and only `:w` gets to make that call. Its entry is marked
  // conflicted so the next opening shows the conflict and waits for the
  // reader. The held store is then the only copy of the text. `write` would
  // clear `pending` and the flag on its way out; nothing goes out here, so
  // they are cleared by hand, or the next note inherits them: `restore`
  // refuses while `pending` is set, and so does the opening's reset of the
  // status. A cleanup re-run on a new `path` is exactly the leave, and so is
  // one on a new `pane`: the pane left holds its own buffer of the note.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pane` is the trigger, and is not read.
  useEffect(
    () => () => {
      if (path === undefined || pending.current === null || !conflicted.current) {
        void write(false, true);
      } else {
        const entry = {
          content: pending.current,
          reason: "Changed on disk before the note was left",
          conflicted: true,
          base: lastBase(path),
        };
        holdText(path, entry, taken.current);
        heldAt.current.set(entry, { seq: saves.current, visit: visit.current });
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        pending.current = null;
        conflicted.current = false;
      }
      // The next visit offers held text afresh, and its buffer holds none yet.
      opening.current = true;
      take(null);
    },
    [path, pane, write, take, lastBase],
  );

  // A reload or a closed tab unmounts nothing, so the flush above never runs
  // for them, and the quiet period's text goes with the page. A phone sending
  // the app to the background fires no `pagehide` at all, only the
  // visibility change, and may never come back to fire anything else.
  //
  // The text is held before anything is sent: a keepalive write can still be
  // refused (over 64 KiB, no network, or the vault moved past its base) with
  // nobody left to hear it, and the held copy is what the next opening offers.
  // A landed write drops it, and one that landed after the page was gone is
  // recognised then by `landedAs`. A conflicted note is held and not written,
  // as on leaving: the reader decides on return.
  //
  // Held text reopened and not touched since is left as it is: the reader has
  // not said to write it, and the entry already holds it, with the reason the
  // vault gave.
  useEffect(() => {
    const hide = () => {
      resendLeft(path);
      if (path === undefined) return;
      // The text held is sent again with keepalive, and the quiet write
      // landing after all drops the held copy.
      const entry = holdOwn(path, "Not yet written when the page was hidden");
      if (entry === undefined) return;
      take(entry);
      if (conflicted.current) return;
      // In `pending` only to be sent: a held in-flight text put there would
      // outlive its own write landing, and leave the note reading unsaved.
      pending.current = entry.content;
      void write(true);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [path, write, take, holdOwn]);

  // Declared last, so its opening effect runs after the leave flush and the hide,
  // which both still count as the visit they leave.
  const { allowReload, reconcile } = useVaultReads(buffer, path, pane, follow);

  return {
    status,
    restored,
    reason,
    change,
    save,
    saveFirst,
    revert,
    isConflicted,
    isWriting,
    allowReload,
    reconcile,
  };
}
