import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import { fetchNote, saveNote } from "@/lib/api";
import { noteBase } from "@/lib/note-base";

/**
 * Writes for a screen that reads its notes once and then saves the same note
 * many times: the review sitting and the parked list.
 *
 * Writes to one note go out one after another, each naming as its base what
 * the write before it landed, and the text read for the first. Sent at once,
 * the second would name the text the first sent, which a note the first write
 * stamped an `id` or a `created` into refuses.
 *
 * A failed write drops the writes queued behind it for that note, each having
 * been worked out from the text it sent, and reads the note again: the screen
 * then holds the vault's text, and the next change names it as its base.
 * Without that, one refusal would leave every later change refused too.
 */
export function useSittingWrites(
  setTexts: Dispatch<SetStateAction<Map<string, string> | null>>,
  setFailed: (message: string) => void,
): { seed: (read: Map<string, string>) => void; write: (note: string, next: string) => void } {
  const queryClient = useQueryClient();
  /** What each note holds as far as this screen knows: the read, then each answer. */
  const landed = useRef(new Map<string, string>());
  /** The last write queued for each note, settled whatever came of it. */
  const chains = useRef(new Map<string, Promise<void>>());
  /** Failures per note, so a write queued before one knows to drop. */
  const failures = useRef(new Map<string, number>());

  const seed = useCallback((read: Map<string, string>) => {
    landed.current = new Map(read);
  }, []);

  const write = useCallback(
    (note: string, next: string) => {
      const failed = () => failures.current.get(note) ?? 0;
      const epoch = failed();

      const send = async () => {
        // The re-read after the failure has already put the vault's text on
        // screen, which this change was never made against.
        if (failed() !== epoch) return;
        const base = landed.current.get(note);
        if (base === undefined) throw new Error(`${note} was never read`);

        const written = await saveNote(note, next, false, noteBase(base));
        landed.current.set(note, written.content);
        // Only while `next` is still what the screen holds: a change made while
        // this was out has moved the note on already.
        setTexts((was) =>
          was?.get(note) === next ? new Map(was).set(note, written.content) : was,
        );
        void queryClient.invalidateQueries({ queryKey: ["cards"] });
      };

      const fail = async (error: unknown) => {
        failures.current.set(note, failed() + 1);
        setFailed(error instanceof Error ? error.message : "could not write the note");
        // A read that fails too leaves the old base, and the next change is
        // refused and reads again.
        const fresh = await fetchNote(note).then(
          (text) => text,
          () => null,
        );
        if (fresh === null) return;
        landed.current.set(note, fresh);
        setTexts((was) => (was === null ? was : new Map(was).set(note, fresh)));
      };

      // At once where nothing is queued, so the write leaves with the tap.
      const queued = chains.current.get(note);
      const sent = queued === undefined ? send() : queued.then(send);
      const settled = sent.then(undefined, fail);
      chains.current.set(note, settled);
      // Gone once settled with nothing behind it, so the next change is at once too.
      void settled.then(() => {
        if (chains.current.get(note) === settled) chains.current.delete(note);
      });
    },
    [queryClient, setFailed, setTexts],
  );

  return { seed, write };
}
