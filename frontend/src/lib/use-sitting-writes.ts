import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import { fetchNote, saveNote } from "@/lib/api";
import { noteBase } from "@/lib/note-base";

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
 * Nothing is dropped. A change made against a write that failed names text
 * that never landed, the vault refuses it, and it fails out loud like the one
 * before it. A failure also reads the note again, so the screen holds the
 * vault's text and the next change is made against that.
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

        const written = await saveNote(note, next, false, noteBase(answers.get(prev) ?? prev));
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
