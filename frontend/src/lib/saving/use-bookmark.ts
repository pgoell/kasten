import { useCallback, useEffect, useRef } from "react";

/** Sixty seconds. A bookmark does not need five-second precision. */
const WAIT_MS = 60_000;

/**
 * When a reading position is written, not what is written. `write` answers whether the vault took
 * the position, and false leaves it for the next chance. It must not throw, or a position is lost.
 * Keyed by note path, so two readers on one note share a timer.
 */
export function useBookmark(write: (note: string, cfi: string) => Promise<boolean>): {
  /** The reader in `note` turned to `cfi`. Starts the wait again. */
  moved: (note: string, cfi: string) => void;
  /** Write what `note` is waiting on now, if anything is. */
  flush: (note: string) => void;
  /** Drop the wait on `note`, keeping where the reader got to. */
  cancel: (note: string) => void;
} {
  /** Where each reader got to, with nothing having written it. */
  const pending = useRef(new Map<string, string>());
  /** One timer per note, cleared and restarted by every `moved`. */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** The last position this session put on disk, per note. */
  const sent = useRef(new Map<string, string>());
  /** The notes with a write out, which is the one at a time rule. */
  const writing = useRef(new Set<string>());

  const send = useCallback(
    (note: string) => {
      const cfi = pending.current.get(note);
      // Nothing new to say, or the note is already being written. Added before any await, so two
      // calls in one tick cannot both pass.
      if (cfi === undefined || cfi === sent.current.get(note)) return;
      if (writing.current.has(note)) return;
      writing.current.add(note);

      void write(note, cfi).then(
        (took) => {
          writing.current.delete(note);
          if (!took) return;
          sent.current.set(note, cfi);
          // Only where nothing newer arrived while this was out.
          if (pending.current.get(note) === cfi) pending.current.delete(note);
        },
        // A two-arm `then`: a `write` that throws would gate its note for the page's life.
        () => {
          writing.current.delete(note);
        },
      );
    },
    [write],
  );

  const clear = useCallback((note: string) => {
    const timer = timers.current.get(note);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(note);
  }, []);

  const moved = useCallback(
    (note: string, cfi: string) => {
      pending.current.set(note, cfi);
      clear(note);
      timers.current.set(
        note,
        setTimeout(() => {
          timers.current.delete(note);
          send(note);
        }, WAIT_MS),
      );
    },
    [clear, send],
  );

  const flush = useCallback(
    (note: string) => {
      // Leave the timer standing: clearing one this call cannot replace strands that turn for good.
      // Sending again on landing would write at request speed while turns keep landing.
      if (writing.current.has(note)) return;
      clear(note);
      // ponytail: a flush the guards refuse is terminal, the timer and pane gone. Reopening the
      // book is the way out; a retry needs somewhere to live that outlives the pane.
      send(note);
    },
    [clear, send],
  );

  // On the way out, no flush: a closed tab losing a minute of position is a documented cost.
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) clearTimeout(timer);
      live.clear();
    };
  }, []);

  return { moved, flush, cancel: clear };
}
