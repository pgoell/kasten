import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import { fetchNote, type Note, saveNote } from "@/lib/api";
import { noteBaseAside } from "@/lib/note-base";
import { BACKOFF, retryable } from "@/lib/read-retry";
import { answered } from "@/lib/review/review-queue";

/**
 * Writes for a screen that reads its notes once and saves them many times. Each names as its base `prev`, or the vault's answer to an earlier write,
 * since `prev` alone fails once the vault stamps an `id` or `created` into the note. Each write settles to its failure, or null where it landed.
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

        // A string where no worker runs, sent with no await so the write still leaves with the tap.
        const hashing = noteBaseAside(answers.get(prev) ?? prev);
        const written = await (typeof hashing === "string"
          ? saved(note, next, hashing)
          : hashing.then((base) => saved(note, next, base)));
        answers.set(next, written.content);
        // Only while `next` is still what the screen holds: a change made while
        // this was out has moved the note on already.
        setTexts((was) => (was?.get(note) === next ? answered(was, note, written.content) : was));
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

/** One write, sent again while the backend restarts. The base is computed once, so every try names the same text. */
async function saved(note: string, next: string, base: string): Promise<Note> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await saveNote(note, next, false, base);
    } catch (error) {
      if (!retryable(error) || attempt === BACKOFF.length) throw error;
      await new Promise((wake) => setTimeout(wake, BACKOFF[attempt]));
    }
  }
}
