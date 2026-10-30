import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Held, holdText } from "@/lib/held-text";
import { type Buffer, forgetAloft, useHeldBuffer } from "@/lib/note/held-buffer";
import { saveQueue } from "@/lib/note/save-queue";
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
  saveQueue.forget();
  forgetAloft();
}

/**
 * Writes one note back to the vault as it is edited, once typing stops or on `save()`.
 * The vault refuses a write whose base it has moved past: that refusal is the only conflict check.
 * A move between two panes on one note is a leave and an opening, or the second pane's typing would
 * replace the first's `pending` text.
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
  // The vault's answer to a failed write, for the bar's hover: only this says why it failed.
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
  // Cleanups run in declaration order: `useHeldBuffer`'s unmount hold goes before the leave flush,
  // which empties `pending`, and the leave flush goes before the hide.
  const { takeFailed, follow, holdOwn } = useHeldBuffer(buffer);
  const { write, save, saveFirst, revert } = useBufferWrite(buffer, path, takeFailed);

  /** Whether the vault has moved past the buffer. A ref read, so the editor's command memo does not rebuild. */
  const isConflicted = useCallback(() => conflicted.current, []);

  /**
   * Whether text for `note` is on its way to the vault. The map alone, since `pending`
   * belongs to the note this hook follows, which the route already refuses by name.
   */
  const isWriting = useCallback((note: string) => saveQueue.busy(note), []);

  const change = useCallback(
    (doc: string) => {
      pending.current = doc;
      // Typing settles nothing while conflicted: `unsaved` would promise a write the timer no longer makes.
      if (!conflicted.current) setStatus("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!conflicted.current) void save();
      }, QUIET_MS);
    },
    [save],
  );

  // Cleanups run with the render's own closure, so a leave writes to the note it was typed in.
  // Nobody hears the outcome, so the promise is dropped. A conflicted note is held, not written:
  // only `:w` may decide over the other writer's text. Its entry is marked conflicted, and the flag
  // and `pending` are cleared by hand, since nothing else clears them. A re-run on a new `path` or `pane` is the leave too.
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
        saveQueue.markHeld(entry);
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

  // A reload or a closed tab runs no cleanup, and a phone sent to the background fires no `pagehide`.
  // Hold before sending: a keepalive write may be refused with nobody left to hear it.
  // A conflicted note is held, not written. Held text not touched since reopening is left alone.
  useEffect(() => {
    const hide = () => {
      saveQueue.resendLeft(path);
      if (path === undefined) return;
      // The quiet write landing after all drops the held copy.
      const entry = holdOwn(path, "Not yet written when the page was hidden");
      if (entry === undefined) return;
      take(entry);
      if (conflicted.current) return;
      // Only to be sent: a held text left in `pending` would outlive its write and read unsaved.
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

  // Declared last, so its opening effect runs after the leave flush and the hide, which still count as the visit they leave.
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
