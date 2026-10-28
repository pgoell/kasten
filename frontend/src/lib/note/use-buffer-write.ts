import { useCallback } from "react";
import { dropText, type Held } from "@/lib/held-text";
import type { Buffer } from "@/lib/note/held-buffer";
import { saveQueue } from "@/lib/note/save-queue";
import { answer } from "@/lib/note/write-answer";

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
   *
   * `keepalive` for the write as the page goes away, which the browser would
   * otherwise cancel along with it. `restoring` for the write `:e!` queues
   * behind one in the air, which puts the vault's text back (#311).
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
      // Reaching this at all is the reader deciding to overwrite: the timer stops
      // short of it while the note stands conflicted, and `:w` does not.
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
          // What the vault held under the buffer as far as this visit knows
          // now, which a held copy of this text keeps to tell on reopening
          // whether somebody else wrote the note since.
          base: lastBase(to),
          sent: reverts.current,
          // The held entry this write carries, read now and not at the
          // answer: a flush on leaving answers after the visit, and with it
          // `taken`, is gone, and an entry held while this was in the air is
          // newer text it never carried.
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

  // Of no arguments, because the editor's save key hands its caller the
  // document, which would read here as a `keepalive` asked for.
  const save = useCallback((): Promise<boolean> => write(false), [write]);

  /**
   * Write what is waiting on the way to doing something else, refusing while
   * the vault has moved past the buffer. Answers whether the vault holds it.
   *
   * Every key that saves before it acts goes through here: closing the note,
   * moving it, moving a folder above it, reading its links. A save while the
   * note stands conflicted is the deliberate overwrite `:w` means, and a key
   * that was pressed for something else does not get to make that call on the
   * reader's behalf. `false` leaves the command undone.
   */
  const saveFirst = useCallback((): Promise<boolean> => {
    if (conflicted.current) return Promise.resolve(false);
    const mine = save();
    // Rename and delete must not race a write in the air (#306): the key
    // waits for the note's queue, the write just made included, and refuses
    // when any write in it did not land.
    const queue = path === undefined ? true : saveQueue.settled(path);
    return Promise.all([mine, queue]).then(([landed, all]) => landed && all);
  }, [save, path, conflicted]);

  /**
   * Throw away what is waiting and take the note off conflict, which is what
   * `:e!` says. Answers whether it did.
   *
   * `:e` without the bang gets a no while the buffer holds text nobody has
   * written, the way vim declines to abandon a modified buffer. The caller
   * reads the vault before asking, so a read that failed leaves the text and
   * the warning exactly where they were.
   *
   * The count is what a write already in flight reads to find out this
   * happened. The timer needs no cancelling here: it wakes to an empty
   * `pending` and `save` turns straight back round.
   */
  const revert = useCallback(
    (force: boolean): boolean => {
      // A write in the air counts as unwritten text too (#291): `write` empties
      // `pending` as it goes out, and once thrown away here its failure would
      // hold nothing.
      const busy = path !== undefined && saveQueue.busy(path);
      if ((pending.current !== null || busy) && !force) return false;

      pending.current = null;
      conflicted.current = false;
      reverts.current += 1;
      if (path !== undefined) saveQueue.drop(path);
      // The caller put the vault's text in the cache before asking, and that is
      // what the buffer holds now. Kept here and not read off the cache later,
      // which a route write's refetch moves under a buffer that declined it.
      onDisk.current =
        path === undefined ? null : (queryClient.getQueryData<string>(["note", path]) ?? null);
      // The other way held text ends: the reader chose the vault's. A write
      // still in the air carries text thrown away too, which a hide must not
      // hold or send again.
      // Only the entry on screen: one the buffer never showed was not looked
      // at, let alone thrown away.
      if (path !== undefined && taken.current) dropText(path, taken.current);
      take(null);
      // Before the write below, which says "saving" and must have the last word.
      setStatus("saved");
      setReason(undefined);
      if (path === undefined) return true;
      // A write already sent lands its text anyway, and the vault would hold
      // what the reader threw away, its event putting it back on the clean
      // screen (#311). So the vault's text goes out behind it, an ordinary
      // write in the queue that names its answer: refused, somebody wrote
      // since, and their text stands. It takes the entry's place in the air,
      // so a hide resends the vault's text and not the thrown-away one. That
      // text and the one sent stay in `stale`, so a slow read of either is
      // declined while the restore is in the air.
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
