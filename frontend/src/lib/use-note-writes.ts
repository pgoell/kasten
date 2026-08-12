import { useCallback, useRef } from "react";

/**
 * One write at a time per note path, whoever is writing.
 *
 * Not tidiness. Both writers here read the whole note and write the whole of it
 * back, so two of them overlapping means the second read predates the first
 * write and whichever lands last throws the other away. Losing a bookmark costs
 * a page; losing a highlight loses something somebody pressed a key for, and it
 * is silent.
 *
 * Nothing on screen ever says this worked, which is why it is written down
 * here rather than left to read off the code.
 */
export function useNoteWrites(): <T>(note: string, work: () => Promise<T>) => Promise<T> {
  /** What each note is doing now. A note nobody is writing holds no entry. */
  const chains = useRef(new Map<string, Promise<unknown>>());

  return useCallback(function write<T>(note: string, work: () => Promise<T>): Promise<T> {
    const queued = chains.current.get(note);
    // A two-arm `then`, so a rejection upstream starts this work rather than
    // gating that note for the life of the page.
    const run = queued === undefined ? work() : queued.then(work, work);
    chains.current.set(note, run);

    // Only where nothing joined the chain behind it, or the map grows an entry
    // per note ever written rather than per note being written.
    const done = () => {
      if (chains.current.get(note) === run) chains.current.delete(note);
    };
    void run.then(done, done);

    return run;
  }, []);
}
