import { ChangedOnDisk, fetchNote, saveNote } from "@/lib/api";
import { withoutTaken } from "@/lib/html-take";
import { noteBase } from "@/lib/note-base";

/** What a take left in the daily note, which its Undo takes back. */
export interface Undo {
  path: string;
  quote: string;
  /** The base the note had when the take was read, so a write since is refused. */
  base: string;
  /** The take's mark on the page, which its Undo takes off and no other. */
  id: number;
}

/** The toast's words for an Undo that left the note as it was. */
export const REFUSED = "The daily note changed since, so Undo left it as it is";

/** The same for a book's note, whose take is a highlight block and not a dump line. */
export const BOOK_REFUSED = "The book's note changed since, so Undo left it as it is";

/** The same for a video's note, whose take is a highlight block of the video's own. */
export const VIDEO_REFUSED = "The video's note changed since, so Undo left it as it is";

/** `note` without the take's text, or null when the take is not in it exactly as it was written. */
type Without = (note: string, quote: string) => string | null;

/** How an Undo ended: taken back, left alone, or failed with a reason to show. */
export type UndoOutcome =
  | { state: "undone" }
  | { state: "refused" }
  | { state: "failed"; message: string };

/**
 * The take's Undo, if the daily note still holds the take's line, or nothing.
 * Read after the dump has landed, so a note the send has not written yet is not
 * offered an Undo it cannot make.
 */
export async function undoFor(
  path: string,
  quote: string,
  id: number,
  without: Without = withoutTaken,
): Promise<Undo | undefined> {
  const text = await fetchNote(path).then(
    (read) => read,
    () => null,
  );
  if (text === null || without(text, quote) === null) return undefined;
  return { path, quote, base: noteBase(text), id };
}

/**
 * Take the take's text back out of its note (the dump line, or a book's
 * highlight block, as `without` says), if the note has not changed since the
 * take. It is read again first and written under the base it was read with, so
 * a write that landed in between is refused, not overwritten.
 */
export async function undoPassage(
  undo: Undo,
  without: Without = withoutTaken,
): Promise<UndoOutcome> {
  try {
    const fresh = await fetchNote(undo.path);
    const next = noteBase(fresh) === undo.base ? without(fresh, undo.quote) : null;
    if (next === null) return { state: "refused" };
    await saveNote(undo.path, next, false, undo.base);
    return { state: "undone" };
  } catch (error) {
    if (error instanceof ChangedOnDisk) return { state: "refused" };
    // Not a vault answer but a failure to get one, or the vault's own refusal.
    if (!(error instanceof Error)) throw error;
    const message =
      error instanceof TypeError ? "No connection, so Undo left the note as it is" : error.message;
    return { state: "failed", message };
  }
}
