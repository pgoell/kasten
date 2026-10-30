import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NotePreview } from "@/components/note-preview";
import { fetchNote, type SearchHit } from "@/lib/api";
import { PANE, PANE_MESSAGE } from "@/lib/overlay-styles";
import { useViewport } from "@/lib/use-viewport";

/**
 * How long the highlight holds still before its note is read.
 *
 * A held ctrl+n walks a row per repeat, and every row it passes through would
 * otherwise be a request for a note nobody is looking at.
 */
const PREVIEW_DELAY_MS = 80;

/**
 * Lines either side of the hit the pane shows. A window, so a 10,000 line note
 * costs what a short one does.
 */
const CONTEXT_LINES = 30;

/** The lines around `line`, and the number the first of them carries. */
function windowAround(text: string, line: number): { lines: string[]; from: number } {
  const all = text.split("\n");
  // Lines count from one and arrays from zero: this is the only place the two meet.
  const at = line - 1;
  const from = Math.max(0, at - CONTEXT_LINES);
  return { lines: all.slice(from, at + CONTEXT_LINES + 1), from };
}

/** The pane beside the list, reading the note around the highlighted hit. */
export function SearchPreview({ hit }: { hit: SearchHit | undefined }) {
  // Trails the highlight, and holds the hit itself: a fresh answer renumbers the rows.
  const [reading, setReading] = useState<SearchHit>();

  // Nothing is read in a narrow window, which has no pane to show it in.
  const { narrow } = useViewport();

  useEffect(() => {
    if (narrow || hit === undefined) {
      setReading(undefined);
      return;
    }
    const timer = setTimeout(() => setReading(hit), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hit, narrow]);

  // Keyed on the path alone, as NoteEditor reads it: Enter then opens a note already fetched.
  // A file hit is read from the text it carries, so the file is never asked for as a note.
  const note = useQuery({
    queryKey: ["note", reading?.path],
    queryFn:
      reading === undefined || reading.place != null ? skipToken : () => fetchNote(reading.path),
    staleTime: 30_000,
    // A preview nobody asked for is not worth three attempts and a backoff.
    retry: false,
  });

  // Undefined while the note loads or refuses: the pane tells those two apart.
  const context =
    reading !== undefined && note.status === "success"
      ? windowAround(note.data, reading.line)
      : undefined;

  if (reading === undefined) return null;

  // The place is the page or chapter, which no note text can show for a pdf or epub.
  if (reading.place != null) {
    return (
      <section aria-label="Preview" data-testid="preview" className={PANE}>
        <p className="px-3 pt-2 font-mono text-k-12 text-k-muted">{reading.place.label}</p>
        <p className="px-3 py-2 font-sans text-k-13 text-k-ink">{reading.text}</p>
      </section>
    );
  }

  return (
    // A labelled section, since a bare pre cannot be named for a screen reader.
    <section aria-label="Preview" data-testid="preview" className={PANE}>
      {context !== undefined ? (
        // Keyed on note and line, so walking to another hit builds a fresh view centred on it.
        <NotePreview
          key={`${reading.path}:${reading.line}`}
          text={context.lines.join("\n")}
          firstLine={context.from + 1}
          markLine={reading.line}
        />
      ) : (
        <p className={PANE_MESSAGE}>
          {/* An empty note is empty, not still loading: a spinner that never stops lies. */}
          {note.status === "error" ? "could not read this note" : "reading the note"}
        </p>
      )}
    </section>
  );
}
