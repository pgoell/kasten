import { ChangedOnDisk, type Note } from "@/lib/api";
import {
  dropText,
  type Held,
  heldTexts,
  holdText,
  landedAs,
  movedTo,
  sameText,
} from "@/lib/held-text";
import type { Buffer } from "@/lib/note/held-buffer";
import { type Queueing, Skipped, saveQueue, type Write } from "@/lib/note/save-queue";

/** The queue's reads a write's answer makes, each as it is called and not as the write went out. */
function readsOf({ write, mine }: Queueing) {
  return {
    // Whether this note's buffer took the vault's text in since this went out.
    reloaded: () => saveQueue.reloadsOf(write.to) !== write.loaded,
    // The flush leaving a note answers with that note's closure, not the next one's.
    here: () => saveQueue.visit === write.opened,
    // Typed on this write's text: the visit that sent it, or one reopened on it since.
    followedHere: () => mine.visit === saveQueue.visit,
  };
}

/** `saved` on the bar, while this visit's buffer is clean and no write to the note is left. */
function showSavedHere(buffer: Buffer, to: string, here: boolean): void {
  if (here && buffer.pending.current === null && !saveQueue.busy(to)) {
    buffer.setStatus("saved");
  }
}

/** The held entry a failed write leaves, and whether the vault refused it. */
function failedHeld(write: Write, failure: unknown, named: string | undefined) {
  const message = failure instanceof Error ? failure.message : String(failure);
  // Somebody else wrote the note since the base this named, and the
  // vault kept their text: a conflict, which only `:w` settles.
  const refused = failure instanceof ChangedOnDisk;
  const held = {
    content: write.content,
    reason: message,
    conflicted: write.wasConflicted || refused,
    base: write.base,
    after: named === write.base ? undefined : named,
  };
  return { held, refused, message };
}

/**
 * Whether the failed text is on screen nowhere, the editor having taken other text since, putting `saved` on the bar if so.
 * In `pending`, `:w` would send it unseen; taken, a save would drop it as carried (#290).
 */
function shownElsewhere(buffer: Buffer, write: Write, reloaded: () => boolean): boolean {
  const { pending, shownRef, setStatus } = buffer;
  const doc = shownRef.current?.();
  const elsewhere =
    reloaded() || (pending.current === null && doc !== undefined && !sameText(doc, write.content));
  if (elsewhere && pending.current === null && !saveQueue.busy(write.to)) setStatus("saved");
  return elsewhere;
}

/** What a write's answer does to the buffer, the cache and the held store, once the vault answers. */
export function answer(
  buffer: Buffer,
  queueing: Queueing,
  takeFailed: (note: string, held: Held) => boolean,
): Promise<boolean> {
  return queueing.request.then(
    (note) => landed(buffer, queueing, note),
    (failure: unknown) => failed(buffer, queueing, takeFailed, failure),
  );
}

/** A write the vault took. */
function landed(buffer: Buffer, queueing: Queueing, note: Note): boolean {
  const { take, setStatus, queryClient, onDisk, taken, reverts, pending } = buffer;
  const { write, since } = queueing;
  const { to, content, sent, carried } = write;
  const { reloaded, here, followedHere } = readsOf(queueing);
  saveQueue.answered(to, queryClient);
  // Drops the entry this write carried, or text typed on it. Entries the buffer never showed stay.
  const now = movedTo(to, since);
  for (const entry of heldTexts(now)) {
    if (entry === carried || entry.content === content || landedAs(entry.content, note.content)) {
      dropText(now, entry);
    }
  }
  // Written now, so no longer held. A second entry, if any, goes on the bar.
  if (here() && (taken.current === carried || taken.current?.content === content)) {
    take(null);
  }
  // Names the answer, not what was sent: the two differ by the `modified` stamp PUT writes.
  // Not after a reload since (#298). A buffer reopened on this text follows the queue, so it counts too (#389).
  if (followedHere() && !reloaded()) onDisk.current = note.content;
  // Not cached if typing or `:e!` came during the write, or a later write is still in the air (#296).
  // That write's answer fills the cache instead, or the keys typed next would be replaced.
  if (pending.current === null && reverts.current === sent && !saveQueue.busy(to)) {
    queryClient.setQueryData(["note", to], note.content);
    if (here()) setStatus("saved");
  }
  return true;
}

/** A write the vault refused, failed or never got. */
function failed(
  buffer: Buffer,
  queueing: Queueing,
  takeFailed: (note: string, held: Held) => boolean,
  failure: unknown,
): boolean {
  const { take, setStatus, setReason, queryClient, conflicted, onDisk, reverts, pending } = buffer;
  const { write, mine, prior, since, reread } = queueing;
  const { to, content, seq, sent, opened, carried, wasConflicted } = write;
  const { keepalive, leaving, restoring } = write;
  const { reloaded, here, followedHere } = readsOf(queueing);
  // Read here, as the write's `named` stood when the vault answered.
  const named = queueing.named();
  // At the top: the early return below would leak the count and leave the note busy forever.
  saveQueue.answered(to, queryClient);
  // Never sent: the buffer holds the vault's text, and this was thrown away.
  if (failure instanceof Skipped) return false;
  // The vault's own text, which nobody typed: a refusal means somebody wrote since (#311).
  if (restoring) {
    showSavedHere(buffer, to, here());
    return false;
  }
  const { held, refused, message } = failedHeld(write, failure, named);
  // A held entry typed on top of this, on this visit, makes this older text stale.
  const now = movedTo(to, since);
  const newer = heldTexts(now).some(
    (entry) => entry.content !== content && saveQueue.newerHeld(entry, write),
  );
  // Not after the buffer took other text since: this text is then on screen nowhere (#297).
  if (newer && !reloaded()) return false;
  // A failure other than a refusal leaves the vault on the text named (#296). The cache takes it once no write is left,
  // and not after a `:e!`, a reload, a conflict or a keepalive (its base is a guess).
  const put = (text: string | undefined) => {
    if (
      text !== undefined &&
      !keepalive &&
      movedTo(to, since) === to &&
      !refused &&
      !wasConflicted &&
      reverts.current === sent &&
      !reloaded() &&
      !saveQueue.busy(to)
    ) {
      queryClient.setQueryData(["note", to], text);
    }
  };
  // No HTTP status: the vault may hold this text after all, so the read stands in for the base (#307).
  const settle = () => {
    // The leave's own text is not the vault's after all: put back what was there.
    if (leaving && !saveQueue.busy(to) && queryClient.getQueryData(["note", to]) === content) {
      if (prior === undefined) queryClient.removeQueries({ queryKey: ["note", to], exact: true });
      else queryClient.setQueryData(["note", to], prior);
    }
    if (!(failure instanceof TypeError) || keepalive) {
      put(named);
      return;
    }
    void reread().then((text) => {
      if (followedHere() && text !== undefined && saveQueue.kept(write) && !reloaded()) {
        onDisk.current = text;
      }
      put(text);
    });
  };
  // Its own send count: a write sent after it, and failing first, holds newer text that must stay.
  saveQueue.markHeld(held, { seq, visit: opened });
  // A later write typed on this text carries it, so holding this would offer a stale conflict.
  if (mine.followed) return false;
  // The flush of a note already left: `pending` holds the next note's text, so this is held for its own note.
  // Ahead of the revert check: a later `:e!` threw away the next note's text, not this.
  if (!here()) {
    holdText(now, held, carried);
    // Reopened on this text, the cache keeps it too, or the clean screen takes the old text and leaves this on the bar (#303).
    // After a remount the old hook's buffer is gone, so the new hook takes the entry (`follow`).
    if (takeFailed(now, held)) return false;
    settle();
    return false;
  }
  // The reader threw this text away: nothing to hold or retry.
  if (reverts.current !== sent) return false;
  // A later write carries newer text on this visit, so this older text must not replace it (#290).
  if (!saveQueue.isNewest(write) && !reloaded()) return false;

  // Held as well as kept: on unmount this hook and its `pending` are gone.
  holdText(now, held, carried);
  // Failed after the editor took other text into a clean buffer: the text is on screen nowhere, so only hold it.
  if (shownElsewhere(buffer, write, reloaded)) return false;
  // The buffer holds this text, so it is the entry the bar leaves out.
  take(held);
  conflicted.current ||= refused;
  setStatus(refused ? "conflict" : "error");
  // Next keystroke or `:w` retries; only `:w` after a refusal.
  pending.current ??= content;
  // After `pending`, so the editor sees the buffer dirty and keeps this text.
  settle();
  setReason(message);
  return false;
}
