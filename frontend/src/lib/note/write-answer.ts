import { ChangedOnDisk } from "@/lib/api";
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
import {
  answered,
  dropped,
  heldAt,
  type Queueing,
  reloads,
  reloadsOf,
  Skipped,
  saves,
  visit,
  writing,
} from "@/lib/note/save-queue";

/** What a write of the buffer sent, and the state it was sent in. */
interface Sent {
  to: string;
  content: string;
  seq: number;
  sent: number;
  loaded: number;
  opened: number;
  kept: number;
  carried: Held | null;
  base: string | undefined;
  wasConflicted: boolean;
  keepalive: boolean;
  leaving: boolean;
  restoring: boolean;
}

/** What a write's answer does to the buffer, the cache and the held store, once the vault answers. */
export function answer(
  buffer: Buffer,
  {
    to,
    content,
    seq,
    sent,
    loaded,
    opened,
    kept,
    carried,
    base,
    wasConflicted,
    keepalive,
    leaving,
    restoring,
  }: Sent,
  queueing: Queueing,
  takeFailed: (note: string, held: Held) => boolean,
): Promise<boolean> {
  const {
    take,
    setStatus,
    setReason,
    queryClient,
    conflicted,
    onDisk,
    taken,
    reverts,
    pending,
    shownRef,
  } = buffer;
  const { request, mine, prior, since, reread } = queueing;
  // Whether this note's buffer took the vault's text in since this went out.
  const reloaded = () => reloadsOf(reloads.current, to) !== loaded;
  // The flush on the way out of a note answers here with that note's
  // closure, after the hook already follows the next one: its slots, its
  // status and its pending text are that one's.
  const here = () => visit.current === opened;
  // Whether the buffer on screen was typed on this write's text: the visit
  // that sent it, or one reopened on it since, which moves the visit here.
  const followedHere = () => mine.visit === visit.current;
  return request.then(
    (note) => {
      answered(to, queryClient);
      // A held entry goes when this write carried it: its own text, or
      // text typed on top of the entry the buffer had taken when this was
      // sent. An entry the buffer never showed, held by a flush that failed
      // after the note was reopened, is still nowhere else, and stays; so
      // does one held while this was in the air.
      const now = movedTo(to, since);
      for (const entry of heldTexts(now)) {
        if (
          entry === carried ||
          entry.content === content ||
          landedAs(entry.content, note.content)
        ) {
          dropText(now, entry);
        }
      }
      // What the buffer took is written now, so nothing on screen is held
      // text any more, and a second entry, if any, goes on the bar. Not when
      // the buffer took newer text since. An entry a hide held of this very
      // text while it was in the air is written now too.
      if (here() && (taken.current === carried || taken.current?.content === content)) {
        take(null);
      }
      // The note that came back and never the text that was sent: the two
      // differ by the `modified` stamp `PUT` writes, and the next save names
      // what is on disk. Not after a reload since this went out: the
      // reload's text came after this answer on disk, and the buffer was
      // typed on it, so the next save names that (#298). Nor only `here()`:
      // a buffer reopened on this text within the route follows it, the
      // queue says so, and a quiet write after this answer finds the queue
      // drained and names what this visit last learned (#389).
      if (followedHere() && !reloaded()) onDisk.current = note.content;
      // Typing during the write leaves newer text behind us, and that is not
      // saved however this one went. The cache waits on the same test: the
      // editor reloads from it, so writing the text that was in the air would
      // take those newer keystrokes off screen. Reopening a note reads this
      // cache too.
      //
      // A `:e!` during the write is the other way this text stops being the
      // note: the reader asked for the vault's version and got it, and
      // putting this in the cache would hand it straight back to them.
      //
      // So is a later write still in the air (#296): `pending` is empty
      // because that one took its text, and this answer on screen would
      // replace it there, and the keys typed next would go onto it. That
      // write's own answer is the one the cache wants. Counted for this
      // note alone: `answered` has already taken this write off.
      if (pending.current === null && reverts.current === sent && !writing.current.has(to)) {
        queryClient.setQueryData(["note", to], note.content);
        if (here()) setStatus("saved");
      }
      return true;
    },
    (failure: unknown) => {
      // Read here, as the write's `named` stood when the vault answered.
      const named = queueing.named();
      // At the top of the arm and not at the foot of it: the line below
      // returns early on a write that failed after a `:e!`, and a count
      // lowered under it would leak for the life of the page, leaving that
      // note reading as busy and never written to again.
      answered(to, queryClient);
      // Never sent: the buffer holds the vault's text, and this was thrown away.
      if (failure instanceof Skipped) return false;
      // The vault's own text, which nobody typed: nothing to hold or to
      // retry. Refused, somebody wrote since, and their event reloads the
      // clean buffer once nothing is in the air (#311).
      if (restoring) {
        if (here() && pending.current === null && !writing.current.has(to)) {
          setStatus("saved");
        }
        return false;
      }
      const message = failure instanceof Error ? failure.message : String(failure);
      // Somebody else wrote the note since the base this named, and the
      // vault kept their text: a conflict, which only `:w` settles.
      const refused = failure instanceof ChangedOnDisk;
      const held = {
        content,
        reason: message,
        conflicted: wasConflicted || refused,
        base,
        after: named === base ? undefined : named,
      };
      // An entry held after this went out, on this visit's buffer, holds
      // newer text typed on top of this, the hide's, which is on screen
      // and on its own way out: this older text is dropped, and goes into
      // neither the store nor `pending`. An entry of this same text is the
      // hide holding this write while it was in the air, and is its own.
      // One held on another visit was typed on other text, and stays
      // beside this.
      const now = movedTo(to, since);
      const newer = heldTexts(now).some((entry) => {
        const at = heldAt.current.get(entry);
        return entry.content !== content && at?.visit === opened && at.seq >= seq;
      });
      // Not once the buffer took other text since this went out: the hide's
      // entry was typed on that, not on this, and this text is on screen
      // nowhere and held nowhere else (#297).
      if (newer && !reloaded()) return false;
      // A failure other than a refusal leaves the vault on the text this
      // named, which an older write behind it may have landed while the
      // cache was kept off it (#296). The cache gets that text once no
      // write to the note is left, or a reopen would read the vault as
      // moved past the held text's base, and a second pane would show the
      // older one. Not after a `:e!` or a reload, which put the vault's
      // text there since, nor for a conflicted note, whose base is stale.
      // Nor for a keepalive, whose base is a guess at what the write ahead
      // of it lands and not an answer, nor once the note moved: the count
      // and the cache key are the old path's.
      const put = (text: string | undefined) => {
        if (
          text !== undefined &&
          !keepalive &&
          movedTo(to, since) === to &&
          !refused &&
          !wasConflicted &&
          reverts.current === sent &&
          !reloaded() &&
          !writing.current.has(to)
        ) {
          queryClient.setQueryData(["note", to], text);
        }
      };
      // With no HTTP status the vault may hold this text after all, so
      // its read stands in for the base named, here and in `onDisk` (#307).
      const settle = () => {
        // The leave's own text is not the vault's after all: what was there
        // goes back, unless a later write or the checks below put more.
        if (
          leaving &&
          !writing.current.has(to) &&
          queryClient.getQueryData(["note", to]) === content
        ) {
          if (prior === undefined)
            queryClient.removeQueries({ queryKey: ["note", to], exact: true });
          else queryClient.setQueryData(["note", to], prior);
        }
        if (!(failure instanceof TypeError) || keepalive) {
          put(named);
          return;
        }
        void reread().then((text) => {
          if (
            followedHere() &&
            text !== undefined &&
            (dropped.current.get(to) ?? 0) === kept &&
            !reloaded()
          ) {
            onDisk.current = text;
          }
          put(text);
        });
      };
      // Its own send count: a write sent after this one and failing first
      // holds newer text, which this must not replace either.
      heldAt.current.set(held, { seq, visit: opened });
      // A later write, of another visit too, was typed on this text and
      // carries it: held, this older text would be offered as a conflict
      // with it, and `:w` there would lose the newer. That write's own
      // failure holds its text, as the #290 rule does on one visit.
      if (mine.followed) return false;
      // The flush of a note already left: `pending` now holds the next note's
      // text, and a retry would write this one's into it. So the text is held
      // for its own note, which takes it back when it is opened again, and
      // the bar lists it meanwhile. Nothing here touches the next note's
      // reading. Ahead of the revert check, because a `:e!` since then was on
      // the next note and threw away that one's text, not this.
      if (!here()) {
        holdText(now, held, carried);
        // Reopened on this very text, the cache keeps it too. Put back,
        // the clean screen would take the old text and leave this on the
        // bar alone (#303). After the route mounted again, this reads the
        // live editor's screen but takes into the old hook's buffer, gone
        // with it, so it decides nothing: the new hook takes the entry
        // (`follow`).
        if (takeFailed(now, held)) return false;
        settle();
        return false;
      }
      // Nothing to hold and nothing to warn about once the reader has thrown
      // this text away: the buffer holds the vault's version, and the retry
      // would be a retry of an edit that no longer exists anywhere.
      if (reverts.current !== sent) return false;
      // A write that went out after this one on this visit carries text
      // typed on top of this, which is on screen and on its own way out
      // (#290). This older text goes into neither the store nor `pending`:
      // kept in `pending`, a leave or `:w` would write it over the newer.
      // Not when the buffer took other text since: the later write was
      // typed on that, and this text is on screen nowhere.
      if (saves.current !== seq && !reloaded()) return false;

      // Held as well as kept, because `here()` is also true for the flush
      // as the route unmounts, when this hook is gone and `pending` with it.
      // In the place of the entry this was typed on, and of no other.
      holdText(now, held, carried);
      // Failed, refused or not, after the editor took other text into a clean
      // buffer: somebody's write since, or the vault's text read back. This
      // text is on screen nowhere, so it is only held, for the bar to list
      // and the next opening to offer. Kept in `pending`, `:w` would send it
      // unseen; taken, a save of what the screen shows would drop it as
      // carried (#290). Counted as well as compared: text typed on top of
      // the reload no longer reads as either.
      const doc = shownRef.current?.();
      const elsewhere =
        reloaded() || (pending.current === null && doc !== undefined && !sameText(doc, content));
      if (elsewhere) {
        if (pending.current === null && !writing.current.has(to)) setStatus("saved");
        return false;
      }
      // The buffer holds this text, so it is the entry the bar leaves out.
      take(held);
      conflicted.current ||= refused;
      setStatus(refused ? "conflict" : "error");
      // Hold on to the text: the next keystroke or `:w` tries again, or
      // only `:w` when the vault refused it.
      pending.current ??= content;
      // After `pending`, so the editor asking about the cache finds the
      // buffer dirty and keeps this text on screen.
      settle();
      setReason(message);
      return false;
    },
  );
}
