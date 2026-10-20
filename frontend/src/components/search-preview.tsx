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
 * How many lines either side of the hit the pane shows.
 *
 * A window rather than the whole note, so a 10,000 line note costs what a
 * short one does. Wider than the pane is tall, so there is room to scroll
 * around the match without there being a note's worth of rows behind it.
 */
const CONTEXT_LINES = 30;

/** The lines around `line`, and the number the first of them carries. */
function windowAround(text: string, line: number): { lines: string[]; from: number } {
  const all = text.split("\n");
  // Lines count from one and arrays from zero, and this is the only place the
  // two meet.
  const at = line - 1;
  const from = Math.max(0, at - CONTEXT_LINES);
  return { lines: all.slice(from, at + CONTEXT_LINES + 1), from };
}

/** The pane beside the list, reading the note around the highlighted hit. */
export function SearchPreview({ hit }: { hit: SearchHit | undefined }) {
  // The hit the pane is reading for, which trails the highlight rather than
  // following it. The hit itself and not its position, because a fresh answer
  // renumbers the list and a position would then point at another line.
  const [reading, setReading] = useState<SearchHit>();

  // Nothing is read in a narrow window, which has no pane to show it in, and
  // with nothing read the pane below is not mounted either.
  const { narrow } = useViewport();

  useEffect(() => {
    if (narrow || hit === undefined) {
      setReading(undefined);
      return;
    }
    const timer = setTimeout(() => setReading(hit), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hit, narrow]);

  // The key `NoteEditor` reads, on purpose: a note read here is one the editor
  // will not have to fetch when Enter opens it. Keyed on the path alone, so
  // walking between two hits of one note re-centres the pane rather than
  // reading the note again.
  const note = useQuery({
    queryKey: ["note", reading?.path],
    queryFn: reading === undefined ? skipToken : () => fetchNote(reading.path),
    staleTime: 30_000,
    // A preview nobody asked for is not worth three attempts and a backoff.
    retry: false,
  });

  // Worked out here rather than in the markup, which has no room to say what
  // `from` is for. Undefined covers both the note still being read and the
  // note refusing to be read; the pane tells those two apart on its own.
  const context =
    reading !== undefined && note.status === "success"
      ? windowAround(note.data, reading.line)
      : undefined;

  if (reading === undefined) return null;

  return (
    // A labelled <section> rather than a bare <pre>, which takes no
    // label of its own and leaves the pane something a screen reader
    // can reach but not name.
    <section aria-label="Preview" data-testid="preview" className={PANE}>
      {context !== undefined ? (
        // Keyed on the note and the line, so walking to another hit
        // builds a fresh view centred on it rather than leaving this
        // one where it was.
        <NotePreview
          key={`${reading.path}:${reading.line}`}
          text={context.lines.join("\n")}
          firstLine={context.from + 1}
          markLine={reading.line}
        />
      ) : (
        <p className={PANE_MESSAGE}>
          {/* An empty note is empty, not still loading, and a spinner
              that never stops is the worse of the two lies. */}
          {note.status === "error" ? "could not read this note" : "reading the note"}
        </p>
      )}
    </section>
  );
}
