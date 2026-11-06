import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ChangedOnDisk, saveNote } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import {
  dropText,
  everyHeld,
  type Held,
  heldTexts,
  holdText,
  RETRY_MS,
  refusedForGood,
} from "@/lib/saving/held-text";

/** A held entry with the one base it was typed on. */
type Based = Held & { base: string };

type Write = <T>(note: string, work: () => Promise<T>) => Promise<T>;

/**
 * Whether another try may land `entry` without a person deciding. Its base must be one text: with
 * a write in the air (`after`) the vault holds either, and with none the write would go unguarded.
 */
function retryable(entry: Held): entry is Based {
  return (
    !entry.conflicted &&
    entry.refused !== true &&
    entry.base !== undefined &&
    entry.after === undefined
  );
}

/** Send `entry` of `path` once, under its base, and settle it by the vault's answer. */
async function resend(path: string, entry: Based, queryClient: QueryClient): Promise<void> {
  try {
    const note = await saveNote(path, entry.content, false, noteBase(entry.base));
    dropText(path, entry);
    queryClient.setQueryData(["note", path], note.content);
  } catch (error) {
    if (error instanceof ChangedOnDisk) holdText(path, { ...entry, conflicted: true }, entry);
    else if (refusedForGood(error)) holdText(path, { ...entry, refused: true }, entry);
    // No signal or a 5xx: the entry waits for the next pass.
    else if (!(error instanceof Error)) throw error;
  }
}

/**
 * One pass over notes no editor holds, each left with one entry a lost signal kept, written under
 * its base so an unseen write refuses it. A note with two entries waits: landing one stales the other.
 */
export async function retryHeld({
  write,
  skip,
  queryClient,
}: {
  write: Write;
  skip: (path: string) => boolean;
  queryClient: QueryClient;
}): Promise<void> {
  const counts = new Map<string, number>();
  for (const { path } of everyHeld()) counts.set(path, (counts.get(path) ?? 0) + 1);
  for (const { path, entry } of everyHeld()) {
    if (counts.get(path) !== 1 || !retryable(entry) || skip(path)) continue;
    await write(path, async () => {
      // Asked again inside the queue: the note may have been opened or settled meanwhile.
      if (!skip(path) && heldTexts(path).includes(entry)) await resend(path, entry, queryClient);
    });
  }
}

/** Runs `retryHeld` when the signal returns and every half minute, one pass at a time. */
export function useHeldRetry(write: Write, skip: (path: string) => boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let running = false;
    const pass = () => {
      if (running || !navigator.onLine) return;
      running = true;
      void retryHeld({ write, skip, queryClient }).finally(() => {
        running = false;
      });
    };
    const every = setInterval(pass, RETRY_MS);
    window.addEventListener("online", pass);
    return () => {
      clearInterval(every);
      window.removeEventListener("online", pass);
    };
  }, [write, skip, queryClient]);
}
