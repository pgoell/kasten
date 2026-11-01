import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { dropText, type Held } from "@/lib/held-text";
import type { Buffer } from "@/lib/note/held-buffer";
import { saveQueue } from "@/lib/note/save-queue";
import { answer } from "@/lib/note/write-answer";

function cachedText(queryClient: QueryClient, path: string | undefined): string | null {
  return path === undefined ? null : (queryClient.getQueryData<string>(["note", path]) ?? null);
}

/** The buffer's writes to the note open: a write, a save and a save that refuses a conflict, and a revert. */
export function useBufferWrite(
  buffer: Buffer,
  path: string | undefined,
  takeFailed: (note: string, held: Held) => boolean,
) {
  const {
    timer,
    pending,
    conflicted,
    reverts,
    onDisk,
    taken,
    take,
    setStatus,
    setReason,
    lastBase,
    queryClient,
  } = buffer;

  /**
   * Resolves to whether the vault holds the text, so `<leader>q` can refuse.
   * `keepalive` for a write as the page goes away. `restoring` for the `:e!` write queued behind one in the air (#311).
   */
  const write = useCallback(
    (keepalive: boolean, leaving = false, restoring = false): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;

      const content = pending.current;
      // Nothing waiting means disk is already up to date, which counts as saved.
      if (path === undefined || content === null) return Promise.resolve(true);
      pending.current = null;
      // Read before the line below clears it: a flush of a conflicted note that
      // fails is held as conflicted, and reopens as the conflict it was.
      const wasConflicted = conflicted.current;
      // The reader's overwrite: the timer stops short of a conflicted note, but `:w` does not.
      conflicted.current = false;
      setStatus("saving");
      setReason(undefined);
      const to = path;
      const queueing = saveQueue.enqueue(
        {
          to,
          content,
          keepalive,
          leaving,
          restoring,
          wasConflicted,
          // The vault's text under the buffer as this visit knows it. A held copy uses it to spot later writes by others.
          base: lastBase(to),
          sent: reverts.current,
          // Read now, not at the answer: by then a flush on leaving has lost `taken`, and an entry held in the air is newer text.
          carried: taken.current,
        },
        queryClient,
      );
      return answer(buffer, queueing, takeFailed);
    },
    [
      path,
      queryClient,
      lastBase,
      takeFailed,
      buffer,
      timer,
      pending,
      conflicted,
      reverts,
      taken,
      setStatus,
      setReason,
    ],
  );

  // No arguments: the editor's save key passes its document, which would read as `keepalive`.
  const save = useCallback((): Promise<boolean> => write(false), [write]);

  /**
   * Write what is waiting before doing something else, refusing while the vault has moved past the buffer.
   * A save while the note is conflicted is `:w`'s overwrite, which a key pressed for something else must not make.
   */
  const saveFirst = useCallback((): Promise<boolean> => {
    if (conflicted.current) return Promise.resolve(false);
    const mine = save();
    // Rename and delete must not race a write in the air (#306): wait for the queue, and refuse if any write in it failed.
    const queue = path === undefined ? true : saveQueue.settled(path);
    return Promise.all([mine, queue]).then(([landed, all]) => landed && all);
  }, [save, path, conflicted]);

  /**
   * Throw away what is waiting and take the note off conflict, as `:e!` does. Answers whether it did.
   * The count tells a write in flight that this happened. The timer needs no cancel: it wakes to an empty `pending`.
   */
  const revert = useCallback(
    (force: boolean): boolean => {
      // A write in the air counts as unwritten text too (#291): once thrown away, its failure would hold nothing.
      const busy = path !== undefined && saveQueue.busy(path);
      if ((pending.current !== null || busy) && !force) return false;

      pending.current = null;
      conflicted.current = false;
      reverts.current += 1;
      if (path !== undefined) saveQueue.drop(path);
      // Read now: a later route refetch can move the cache under a buffer that declined it.
      onDisk.current = cachedText(queryClient, path);
      // The reader chose the vault's text, so the entry on screen is no longer held.
      // A write in the air carries the thrown-away text too, which a hide must not resend.
      if (path !== undefined && taken.current) dropText(path, taken.current);
      take(null);
      // Before the write below, which says "saving" and must have the last word.
      setStatus("saved");
      setReason(undefined);
      if (path === undefined) return true;
      // A write already sent lands its text anyway, and the vault would hold what the reader threw away (#311).
      // So the vault's text goes out behind it, as a write that names its answer: refused, or somebody wrote since.
      // It takes the entry's place in the air, and `stale` keeps both texts so a slow read of either is declined.
      saveQueue.revert(
        path,
        busy && onDisk.current !== null
          ? () => {
              pending.current = onDisk.current;
              void write(false, false, true);
            }
          : undefined,
      );
      return true;
    },
    [
      path,
      take,
      queryClient,
      write,
      pending,
      conflicted,
      reverts,
      onDisk,
      taken,
      setStatus,
      setReason,
    ],
  );

  return { write, save, saveFirst, revert };
}
