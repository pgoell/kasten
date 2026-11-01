import type { QueryClient } from "@tanstack/react-query";
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect } from "react";
import { type Held, heldTexts, holdText, sameText } from "@/lib/held-text";
import { heldOf, type InAir, sentUnder, unseenOf } from "@/lib/note/in-air";
import { saveQueue } from "@/lib/note/save-queue";
import type { SaveStatus } from "@/lib/note/use-autosave";

/** The per-visit refs and stable functions of one `useAutosave` hook, shared by its sub-hooks. */
export interface Buffer {
  // Its identity never changes, and the effect reading it must run on an opening only.
  shownRef: RefObject<(() => string | undefined) | undefined>;
  // Read by a flush answering after its visit left: the note may be open again.
  openRef: RefObject<string | undefined>;
  // Text waiting to go out, null when disk is up to date. A ref, so a keystroke skips a re-render.
  pending: RefObject<string | null>;
  timer: RefObject<ReturnType<typeof setTimeout> | null>;
  // The vault's text under the buffer as this visit last learned it. A save names it as its base.
  onDisk: RefObject<string | null>;
  // Mirrors status === "conflict" where the quiet-period timer can see it, since its closure is older.
  conflicted: RefObject<boolean>;
  // Counted, not flagged: a second `:e!` during a write must read as another revert.
  // `pending` cannot tell that, since a revert empties it like a finished write does.
  reverts: RefObject<number>;
  // The entry the buffer holds, by identity. A flush that failed after a reopen holds another
  // entry the buffer never saw, and a save of the buffer must not take that one with it.
  taken: RefObject<Held | null>;
  // Held text is offered once, at opening. A later entry would put text in `pending` that the screen does not show.
  opening: RefObject<boolean>;
  offered: RefObject<Held | undefined>;
  take: (entry: Held | null) => void;
  setStatus: Dispatch<SetStateAction<SaveStatus>>;
  setReason: Dispatch<SetStateAction<string | undefined>>;
  queryClient: QueryClient;
  lastBase: (note: string) => string | undefined;
}

/**
 * The entries held as the route unmounted, with writes then in the air.
 * The leave's cache reads to the next hook as the vault's text (#382). Each leaves the store when its write answers.
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

/** The write in the air, unless a reload or a restore has passed it. */
function freshAir(air: InAir | undefined, loaded: number): InAir | undefined {
  return air?.loaded === loaded && !air.restoring ? air : undefined;
}

/** `before`, unless it is `content` itself. */
function unlike(before: string | undefined, content: string): string | undefined {
  return before !== undefined && before !== content ? before : undefined;
}

function holdOffScreen(note: string, offScreen: InAir, reason: string, conflicted: boolean): void {
  const { entry } = heldOf(offScreen, reason, conflicted);
  holdText(note, entry);
  saveQueue.markHeld(entry, { seq: saveQueue.sends, visit: offScreen.visit });
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
   * Take the entry a failed write of `note` held into a clean buffer reopened on its text, which nothing else is writing.
   * Answers whether it did.
   */
  const takeFailed = useCallback(
    (note: string, held: Held): boolean => {
      const doc = shownRef.current?.();
      if (
        openRef.current !== note ||
        pending.current !== null ||
        saveQueue.busy(note) ||
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
   * Follow the write to `note` in the air whose text the buffer reopened on, and hear its answer alone (#387).
   * Landed, its answer is the base; failed, the clean buffer takes the entry it held.
   */
  const follow = useCallback(
    (note: string, held: Held) => {
      const queue = saveQueue.follow(note);
      if (queue === undefined) return;
      const at = saveQueue.visit;
      const loaded = saveQueue.reloadsOf(note);
      // A `:e!` since put the vault's text under the buffer, and queued the
      // write that answers for it.
      const sent = reverts.current;
      const moved = () =>
        saveQueue.visit !== at || saveQueue.reloadsOf(note) !== loaded || reverts.current !== sent;
      const retake = () => {
        const failed = heldTexts(note).find((entry) => entry.content === held.content);
        if (failed !== undefined) takeFailed(note, failed);
      };
      void Promise.all([queue.link, queue.ok]).then(([text, ok]) => {
        if (moved()) return;
        if (text !== undefined) onDisk.current = text;
        if (ok) {
          if (taken.current === held) take(null);
          return;
        }
        retake();
      });
    },
    [take, takeFailed, reverts, onDisk, taken],
  );

  /**
   * Hold the text the page going away would lose: a quiet write in the air, and what is waiting. Not a reload's text (#306), nor the `:e!` text nobody typed (#311).
   * Answers the entry held, or undefined when that text is held already or there is none.
   */
  const holdOwn = useCallback(
    (note: string, reason: string): Held | undefined => {
      const loaded = saveQueue.reloadsOf(note);
      const follows = saveQueue.follows(note);
      const air = saveQueue.air(note);
      const fresh = freshAir(air, loaded);
      // Held under the base it was typed on, so a dying page keeps text the screen never showed (#314, #317).
      const offScreen = follows ? unseenOf(fresh) : fresh;
      if (offScreen !== undefined) {
        holdOffScreen(note, offScreen, reason, conflicted.current);
        if (!follows && pending.current === null) return undefined;
      }
      const content = pending.current ?? fresh?.content;
      if (content === undefined) return undefined;
      if (content === taken.current?.content) return undefined;
      // Typed on the last write sent, not a queued one that never reached the vault (#310).
      // Kept beside the base: the page may die before that write lands.
      const before = follows ? sentUnder(air, loaded) : undefined;
      const entry = {
        content,
        reason,
        conflicted: conflicted.current,
        base: lastBase(note),
        after: unlike(before, content),
      };
      holdText(note, entry, taken.current);
      // After every write already in the air, which a failing one reads.
      saveQueue.markHeld(entry);
      return entry;
    },
    [lastBase, pending, conflicted, taken],
  );

  // Declared before useAutosave's leave flush, which empties `pending`: React runs unmount cleanups in order (#382).
  // Unmount only, since a note left within the route is the hide's to hold.
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
