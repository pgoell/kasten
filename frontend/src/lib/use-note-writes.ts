import { useCallback, useRef } from "react";

/**
 * One write at a time per note, whoever writes. Each writer rewrites the whole note, so an overlap
 * silently drops the earlier write.
 */
export function useNoteWrites(): <T>(note: string, work: () => Promise<T>) => Promise<T> {
  /** The write in flight per note. Idle notes hold no entry. */
  const chains = useRef(new Map<string, Promise<unknown>>());

  return useCallback(function write<T>(note: string, work: () => Promise<T>): Promise<T> {
    const queued = chains.current.get(note);
    // Two-arm `then`: a failed write must not gate that note for the life of the page.
    const run = queued === undefined ? work() : queued.then(work, work);
    chains.current.set(note, run);

    // Delete only if nothing queued behind, or the map grows per note ever written.
    const done = () => {
      if (chains.current.get(note) === run) chains.current.delete(note);
    };
    void run.then(done, done);

    return run;
  }, []);
}
