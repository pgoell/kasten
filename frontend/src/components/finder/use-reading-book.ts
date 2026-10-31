import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { PaneMoves } from "@/components/use-pane-moves";
import { fetchAssets, fetchFiles, fetchNote, NoteMissing } from "@/lib/api";
import { READING_NOTE } from "@/lib/layout";
import { noteName } from "@/lib/note-path";
import { openBookInFocused } from "@/lib/pane-contents";
import { splitTarget, wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

/**
 * Opens the book `READING_NOTE` links. The note is read fresh on each press: it is
 * hand-edited, and a 404 is the answer that says it is missing.
 */
export function useReadingBook({
  saveFirst,
  moveTo,
  setNotice,
}: {
  saveFirst: () => Promise<boolean>;
  moveTo: PaneMoves["moveTo"];
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    setNotice(undefined);

    // Saved first: the pane may hold the config note, whose new link would read as the old.
    if (!(await saveFirst())) return;

    // Read through the query cache, so a press right after load waits for the listings.
    let text: string;
    let paths: string[];
    let books: string[];
    try {
      [text, paths, books] = await Promise.all([
        fetchNote(READING_NOTE),
        queryClient.ensureQueryData({ queryKey: ["files"], queryFn: fetchFiles }),
        queryClient.ensureQueryData({ queryKey: ["assets"], queryFn: fetchAssets }),
      ]);
    } catch (error: unknown) {
      if (error instanceof NoteMissing) setNotice(`${READING_NOTE} is not there`);
      else setNotice(error instanceof Error ? error.message : `${READING_NOTE} could not be read`);
      return;
    }

    const target = wikiLinkTargets(text)[0];
    if (target === undefined || splitTarget(target).name === "") {
      setNotice(`${READING_NOTE} links no book note`);
      return;
    }

    // wikiLinkPath falls back to the inbox, so the listing is what says no note.
    const note = wikiLinkPath(target, paths);
    if (!note.endsWith(".md") || !paths.includes(note)) {
      setNotice(`[[${target}]] in ${noteName(READING_NOTE)}.md names no note`);
      return;
    }

    // Pairs as the backend does, both suffixes; withBooks in note-finder.tsx follows it.
    const stem = note.slice(0, -".md".length);
    if (!books.some((path) => path === `${stem}.epub` || path === `${stem}.pdf`)) {
      setNotice(`Nothing to read beside ${note}`);
      return;
    }

    // The reader finds the `reading:` place in the note itself.
    moveTo((previous) => openBookInFocused(previous, note));
  }, [queryClient, saveFirst, moveTo, setNotice]);
}
