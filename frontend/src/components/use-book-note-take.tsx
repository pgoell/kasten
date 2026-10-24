import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef } from "react";
import { useTakeToast } from "@/components/use-take-toast";
import { collapse, type Passage } from "@/lib/highlight";
import { withoutHighlight } from "@/lib/highlight-undo";
import { aliasOf, fileLink, needsMarkdown } from "@/lib/html-take";
import { noteName } from "@/lib/note-path";
import { BOOK_REFUSED, undoFor } from "@/lib/page-undo";

/**
 * The take out of a book: the passage goes into the book's note under its
 * highlights, and the shared toast offers to take it back or to put it in a
 * note. `onTake` writes the passage and answers the anchor id it wrote, or null
 * when it wrote nothing (the bar already says why).
 */
export function useBookNoteTake({
  note,
  archive,
  onTake,
  title = "Taken into the book's note",
  refused = BOOK_REFUSED,
}: {
  note: string;
  archive: boolean;
  onTake: (passage: Passage) => Promise<string | null>;
  /** The toast's line once the take has landed. The book's when left out. */
  title?: string;
  /** The toast's line when an Undo leaves the note as it was. The book's when left out. */
  refused?: string;
}): {
  /** Take the passage, and show the toast when the write landed on the book the pane still shows. */
  take(passage: Passage, top: boolean): Promise<void>;
  /** Drop the toast and let a take in flight show nothing (a new book in the pane). */
  forget(): void;
  /** The toast, or null; the pane renders it inside its wrapper. */
  toast: ReactNode;
} {
  const queryClient = useQueryClient();
  const toast = useTakeToast({
    archive,
    refused,
    without: withoutHighlight,
    // The mark and the note column follow the Undo at once, not on the next read.
    onUnmarked: () => void queryClient.invalidateQueries({ queryKey: ["note", note] }),
  });
  // Per hook, so each take's Undo answers to its own mark.
  const marks = useRef(0);

  async function take(passage: Passage, top: boolean): Promise<void> {
    // Read before the await, so a book opened meanwhile is seen (the stale-take guard of #898).
    const started = toast.generation();
    const id = await onTake(passage);
    if (id === null || toast.moved(started)) return;

    marks.current += 1;
    const undo = await undoFor(note, id, marks.current, withoutHighlight);
    if (toast.moved(started)) return;

    const chapter = collapse(passage.chapter);
    toast.show(
      title,
      {
        text: passage.text,
        // The link back to the highlight's block in the book's note, written from
        // the note it lands in, so a note in another folder gets the right path.
        linkIn: (from) => linkBack(note, id, chapter, from),
        source: chapter === "" ? noteName(note) : `${chapter}, ${noteName(note)}`,
        top,
      },
      undo,
    );
  }

  return { take, forget: toast.forget, toast: toast.toast };
}

/** `[[<note>#^<id>|<chapter>]]`, or the markdown form for a note whose name a wikilink cannot hold. */
function linkBack(note: string, id: string, chapter: string, from: string): string {
  const target = needsMarkdown(note) ? note : note.replace(/\.md$/, "");
  const name = needsMarkdown(note) ? aliasOf(noteName(note)) : noteName(note);
  return fileLink(target, `^${id}`, aliasOf(chapter) || name, from);
}
