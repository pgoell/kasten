import type { QueryClient } from "@tanstack/react-query";
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect } from "react";
import { type Held, heldTexts, holdText, sameText } from "@/lib/held-text";
import {
  heldAt,
  inAir,
  queued,
  reloads,
  reloadsOf,
  saves,
  sentUnder,
  unseenOf,
  visit,
  writing,
} from "@/lib/save-queue";
import type { SaveStatus } from "@/lib/use-autosave";

/** The per-visit refs and stable functions of one `useAutosave` hook, shared by its sub-hooks. */
export interface Buffer {
  // Read in effects, and its identity never changes, so listing it in a
  // dependency list changes nothing. The route builds a new `shown` per render,
  // and the effect it is read in must run on an opening and nothing else.
  shownRef: RefObject<(() => string | undefined) | undefined>;
  // The note followed now, for a flush answering with the closure of the
  // visit it left: that note may be open again by then.
  openRef: RefObject<string | undefined>;
  // The text waiting to go out, or null when disk is up to date. A ref, not
  // state: a keystroke must not re-render the tree around CodeMirror.
  pending: RefObject<string | null>;
  timer: RefObject<ReturnType<typeof setTimeout> | null>;
  // The vault's text under the buffer as this visit last learned it: our last
  // write's answer, a reload taken into a clean buffer, held text found landed.
  // What a save names as its base.
  onDisk: RefObject<string | null>;
  // The same reading as `status === "conflict"`, held where the quiet-period
  // timer can see it: that timer was scheduled by an older render, and the
  // status it closed over is the one from before the conflict.
  conflicted: RefObject<boolean>;
  // How many times the reader has thrown the buffer away, which a write in
  // flight compares against the reading it left with.
  //
  // `pending.current === null` cannot answer that question. A write empties it
  // on the way out and `revert` empties it too, so a write reading it as
  // "nothing newer was typed" would take a revert for the all clear and put the
  // discarded text back in the cache, from where the editor reads it onto the
  // screen. Reverts are counted rather than flagged because a second `:e!`
  // during the same write has to read as another one.
  reverts: RefObject<number>;
  // The held entry the buffer holds, by identity, and the same as state for
  // the bar, which leaves out that entry alone while it is on screen.
  // Identity rather than path: a flush that fails after its note was reopened
  // holds a second entry the buffer never saw, and a save of the buffer must
  // not take that one with it.
  taken: RefObject<Held | null>;
  // Whether this visit's own effect is still to run, and the entry held for the
  // note when it did. Held text is offered once, at opening: an entry held
  // later came from a flush that failed after the editor had already opened on
  // the vault's text, and taking it then would put text in `pending` that the
  // buffer does not show.
  opening: RefObject<boolean>;
  offered: RefObject<Held | undefined>;
  take: (entry: Held | null) => void;
  setStatus: Dispatch<SetStateAction<SaveStatus>>;
  setReason: Dispatch<SetStateAction<string | undefined>>;
  queryClient: QueryClient;
  lastBase: (note: string) => string | undefined;
}

/**
 * The entries held as the editor route unmounted, of writes then in the air.
 * The cache the leave filled reads to the hook mounted next as the vault's
 * text (#382). Each leaves the store when its write answers.
 */
let leftAloft = new WeakSet<Held>();

/** Forget the entries left aloft, as a new page starts with none. */
export function forgetAloft(): void {
  leftAloft = new WeakSet();
}

/** Whether `entry` was left aloft by the route as it unmounted, its write still in the air. */
export function wasLeftAloft(entry: Held): boolean {
  return leftAloft.has(entry);
}

export function useHeldBuffer(buffer: Buffer) {
  const {
    shownRef,
    openRef,
    pending,
    conflicted,
    reverts,
    taken,
    take,
    setStatus,
    setReason,
    lastBase,
    onDisk,
  } = buffer;

  /**
   * Take the entry a write of `note` held as it failed into a clean buffer
   * reopened on its text, which nothing else is writing: the screen keeps it,
   * taken as a failed write is. Answers whether it did.
   */
  const takeFailed = useCallback(
    (note: string, held: Held): boolean => {
      const doc = shownRef.current?.();
      if (
        openRef.current !== note ||
        pending.current !== null ||
        writing.current.has(note) ||
        doc === undefined ||
        !sameText(doc, held.content)
      ) {
        return false;
      }
      take(held);
      pending.current = held.content;
      conflicted.current ||= held.conflicted;
      setStatus(conflicted.current ? "conflict" : "error");
      setReason(held.reason);
      return true;
    },
    [take, shownRef, openRef, pending, conflicted, setStatus, setReason],
  );

  /**
   * Follow the write to `note` in the air whose text the buffer reopened on,
   * sent by the hook that went with the route and hears its answer alone
   * (#387). Landed, its answer is the base; failed, the clean buffer takes
   * the entry it held, as on a reopen within the route.
   */
  const follow = useCallback(
    (note: string, held: Held) => {
      const queue = queued.current.get(note);
      if (queue === undefined) return;
      queue.visit = visit.current;
      const at = visit.current;
      const loaded = reloadsOf(reloads.current, note);
      // A `:e!` since put the vault's text under the buffer, and queued the
      // write that answers for it.
      const sent = reverts.current;
      void Promise.all([queue.link, queue.ok]).then(([text, ok]) => {
        if (
          visit.current !== at ||
          reloadsOf(reloads.current, note) !== loaded ||
          reverts.current !== sent
        ) {
          return;
        }
        if (text !== undefined) onDisk.current = text;
        if (ok) {
          if (taken.current === held) take(null);
          return;
        }
        const failed = heldTexts(note).find((entry) => entry.content === held.content);
        if (failed !== undefined) takeFailed(note, failed);
      });
    },
    [take, takeFailed, reverts, onDisk, taken],
  );

  /**
   * Hold the text of `note`'s buffer that the page going away would lose: a
   * quiet write in the air, and what is waiting. Answers the entry held for
   * what is waiting, or of the write in the air when nothing is, which a hide
   * then sends; undefined when that text is held already or there is none.
   *
   * Nothing waiting, but a quiet write may still be in the air, and the page
   * going away cancels it. Not after a reload since it went out: that text is
   * on screen nowhere (#306). Nor the write `:e!` queued with the vault's
   * text, which nobody typed: held, it would read as the reader's and stand as
   * a conflict with whoever wrote since (#311).
   */
  const holdOwn = useCallback(
    (note: string, reason: string): Held | undefined => {
      const loaded = reloadsOf(reloads.current, note);
      const queue = queued.current.get(note);
      const follows = queue?.visit === visit.current && queue.loaded === loaded;
      const air = inAir.current.get(note);
      const fresh = air?.loaded === loaded && !air.restoring ? air : undefined;
      // A buffer reopened on the text under that write, which it does not
      // follow, shows other text: a keepalive would land this unseen (#314). Held
      // only, under the base it was typed on, so the page dying still keeps
      // it, and the quiet write landing drops it. Beside it the text the write
      // named, as the hide's loop keeps it: a write ahead of it that landed is
      // the reader's own, no conflict on reopening. Held as well when text was
      // typed on the screen's text since: that goes out on its own, and the
      // page dying would cancel the write and keep its text nowhere (#317).
      // So too when that text already went to the queue and the buffer follows
      // its own write, still waiting behind the one it never took.
      const offScreen = follows ? unseenOf(fresh) : fresh;
      if (offScreen !== undefined) {
        const out = offScreen.sent?.loaded === offScreen.loaded ? offScreen.sent : undefined;
        const under =
          out === undefined
            ? offScreen.base
            : out.content === offScreen.content
              ? (offScreen.named ?? offScreen.base)
              : out.content;
        const entry: Held = {
          content: offScreen.content,
          reason,
          conflicted: conflicted.current,
          base: offScreen.base,
          after: under !== offScreen.base ? under : undefined,
        };
        holdText(note, entry);
        heldAt.current.set(entry, { seq: saves.current, visit: offScreen.visit });
        if (!follows && pending.current === null) return undefined;
      }
      const content = pending.current ?? fresh?.content;
      if (content === undefined) return undefined;
      if (content === taken.current?.content) return undefined;
      // Text typed behind a write in the air is typed on that write's text,
      // which the keepalive names: the last one sent, a queued one never
      // reaching the vault (#310). Kept beside the base and not in its place:
      // the page may die before that write arrives. Not after a reload since
      // that write went out, which the text was typed on instead, nor when the
      // buffer does not follow the queue, `write`'s own test.
      const before = follows ? sentUnder(air, loaded) : undefined;
      const entry = {
        content,
        reason,
        conflicted: conflicted.current,
        base: lastBase(note),
        after: before !== undefined && before !== content ? before : undefined,
      };
      holdText(note, entry, taken.current);
      // After every write already in the air, which a failing one reads.
      heldAt.current.set(entry, { seq: saves.current, visit: visit.current });
      return entry;
    },
    [lastBase, pending, conflicted, taken],
  );

  // Leaving the route takes the `pagehide` listener in `useAutosave`'s hide
  // effect with it, so a page closed before the leave flush there answers
  // cancels it unheard, and the quiet write in the air too (#382). Their text
  // is held first, as a hide holds it, and each one landing drops its copy.
  // Only on unmount: a note left within the route is still the hide's to hold,
  // and holding it here would list it on the bar until its flush lands. Declared
  // before the leave flush in `useAutosave`, which empties `pending`, because
  // React runs an unmount's cleanups in order.
  useEffect(
    () => () => {
      if (openRef.current === undefined) return;
      const entry = holdOwn(openRef.current, "Not yet written when the note was left");
      if (entry !== undefined) leftAloft.add(entry);
    },
    [holdOwn, openRef],
  );

  return { takeFailed, follow, holdOwn };
}
