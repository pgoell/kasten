import { useCallback, useEffect, useRef } from "react";

/** Sixty seconds. A bookmark does not need five-second precision. */
const WAIT_MS = 60_000;

/**
 * When a reading position is written, and nothing about what is written.
 *
 * The scheduler alone: it holds no rule about focus or about the listing, those
 * living in the `write` it is handed. `write` answers whether the vault took the
 * position, and a no leaves it waiting for the next chance. It is written not to
 * throw, and a throw costs one position rather than the note.
 *
 * Everything is keyed by note path, so two readers on two notes do not share a
 * timer and two panes reading one note share one.
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
      // Nothing to say, or nothing new to say, or the note is already busy
      // saying it. Added to the set before anything is awaited, so two calls in
      // one tick cannot both get through.
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
        // A two-arm `then` rather than a promise about code in another module:
        // a `write` that broke its contract and threw would otherwise gate that
        // note for the life of the page.
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
      // Doing nothing at all, and leaving that note's timer standing. A page
      // turn during a write armed a fresh timer, and clearing a timer this call
      // cannot replace strands that turn for good; sending again when the write
      // lands is the other wrong answer, and it writes at request speed for as
      // long as turns keep landing during writes.
      if (writing.current.has(note)) return;
      clear(note);
      // ponytail: a flush whose write the guards then refuse is terminal, the
      // timer being gone and the pane with it. Opening the book again and
      // turning a page is the way out; a retry needs somewhere to live that
      // outlives the pane.
      send(note);
    },
    [clear, send],
  );

  // Every timer, on the way out. Not a flush: the page is going away, and
  // losing a minute of position to a closed tab is a documented cost.
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) clearTimeout(timer);
      live.clear();
    };
  }, []);

  return { moved, flush, cancel: clear };
}
