import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import { fetchNote, type Note, saveNote } from "@/lib/api";
import { noteBase } from "@/lib/note-base";

/** Waits between the tries of a write the backend dropped: about a minute in all. */
const BACKOFF = [1000, 2000, 4000, 8000, 15000, 15000, 15000];

/**
 * A write that failed because the backend is down or restarting: a gateway
 * answer, or no answer, which fetch reports as a `TypeError`. `saveNote` puts
 * the status of a failed save in `cause`.
 */
function retryable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (
    error instanceof Error &&
    typeof error.cause === "number" &&
    [502, 503, 504].includes(error.cause)
  );
}

/**
 * Writes for a screen that reads its notes once and then saves the same note
 * many times: the review sitting and the parked list.
 *
 * Each write names as its base the text its change was made against, `prev`,
 * or what the vault answered where `prev` is a text this screen sent and saw
 * land. Sending `prev` itself would fail on a note the write stamped an `id`
 * or a `created` into. Writes to one note go out one after another, so that
 * answer is in before the write after it leaves.
 *
 * Nothing is dropped. A write that fails while the backend restarts goes again
 * for about a minute, with the same text over the same base. That is safe: the
 * vault answers with the note as it stands and writes nothing when the base is
 * text it already holds, and refuses a base that has moved on. A write that
 * still fails names text that never landed, the vault refuses it, and it fails
 * out loud like the one before it. A failure also reads the note again, so the
 * screen holds the vault's text and the next change is made against that.
 *
 * Each write answers, once settled, what it failed with or null where it
 * landed, so the sitting's undo puts the card back only for a write that took.
 */
export function useSittingWrites(
  setTexts: Dispatch<SetStateAction<Map<string, string> | null>>,
  setFailed: (message: string) => void,
): (note: string, prev: string, next: string) => Promise<unknown> {
  const queryClient = useQueryClient();
  /** Per note, each text sent and seen to land, and what the vault answered for it. */
  const landed = useRef(new Map<string, Map<string, string>>());
  /** The last write queued for each note, settled whatever came of it. */
  const chains = useRef(new Map<string, Promise<unknown>>());

  return useCallback(
    (note: string, prev: string, next: string) => {
      const send = async () => {
        const answers = landed.current.get(note) ?? new Map<string, string>();
        landed.current.set(note, answers);

        // The base is computed once, so every try names the same text.
        const base = noteBase(answers.get(prev) ?? prev);
        let written: Note;
        for (let attempt = 0; ; attempt++) {
          try {
            written = await saveNote(note, next, false, base);
            break;
          } catch (error) {
            if (!retryable(error) || attempt === BACKOFF.length) throw error;
            await new Promise((wake) => setTimeout(wake, BACKOFF[attempt]));
          }
        }
        answers.set(next, written.content);
        // Only while `next` is still what the screen holds: a change made while
        // this was out has moved the note on already.
        setTexts((was) =>
          was?.get(note) === next ? new Map(was).set(note, written.content) : was,
        );
        void queryClient.invalidateQueries({ queryKey: ["cards"] });
      };

      const fail = async (error: unknown) => {
        setFailed(error instanceof Error ? error.message : "could not write the note");
        // A read that fails too leaves the screen as it is, and the next change
        // is refused and reads again.
        const fresh = await fetchNote(note).then(
          (text) => text,
          () => null,
        );
        if (fresh !== null) setTexts((was) => (was === null ? was : new Map(was).set(note, fresh)));
        return error;
      };

      // At once where nothing is queued, so the write leaves with the tap.
      const queued = chains.current.get(note);
      const sent = queued === undefined ? send() : queued.then(send);
      const settled = sent.then(() => null, fail);
      chains.current.set(note, settled);
      // Gone once settled with nothing behind it, so the next change is at once too.
      void settled.then(() => {
        if (chains.current.get(note) === settled) chains.current.delete(note);
      });
      return settled;
    },
    [queryClient, setFailed, setTexts],
  );
}
