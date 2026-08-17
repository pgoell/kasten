import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { fetchCards, fetchNote } from "@/lib/api";
import { noteName } from "@/lib/note-path";
import { parkedNotes } from "@/lib/review";
import { type Parked, parseCards, readNoteSuspended } from "@/lib/srs";

/** One row: a card the sitting will not ask, and where to find it again. */
interface ParkedRow {
  note: string;
  /** Its ordinal among the note's cards, the same address a Seat carries. */
  at: number;
  front: string;
  deck: string;
  reason: Parked;
}

interface ReviewParkedProps {
  /** Back to the overview, which is the `← Decks` button and the pane's `h`. */
  onLeave: () => void;
  /** Open the note this row is written in, which is how a stub gets its answer. */
  onOpen: (note: string) => void;
  /** Whether to read notes filed in the archive. Off, the way the overview is. */
  archive?: boolean;
}

/**
 * Every card the review is holding back, and why.
 *
 * The notes are read whole rather than counted off the scan's lines, which is
 * the one place this screen costs more than the overview. It has to: putting a
 * card back means editing the line it is written on and writing the note, and
 * the front of a card written over several lines is not among the lines the
 * scan matched.
 */
export function ReviewParked({ onLeave, onOpen, archive = false }: ReviewParkedProps) {
  const [texts, setTexts] = useState<Map<string, string> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // The same key the overview holds, so opening this screen reads no cards the
  // list behind it has not already fetched.
  const { data: hits } = useQuery({
    queryKey: ["cards", archive],
    queryFn: () => fetchCards(archive),
  });

  const notes = useMemo(() => (hits === undefined ? [] : parkedNotes(hits)), [hits]);

  useEffect(() => {
    let live = true;
    void Promise.all(notes.map(async (note) => [note, await fetchNote(note)] as const)).then(
      (read) => {
        if (live) setTexts(new Map(read));
      },
      (error: unknown) => {
        if (live) setFailed(error instanceof Error ? error.message : "could not read the note");
      },
    );
    return () => {
      live = false;
    };
  }, [notes]);

  const rows = useMemo(() => rowsOf(texts ?? new Map()), [texts]);

  return (
    <div className="flex h-full flex-col bg-one-bg font-mono text-one-fg">
      <header className="flex items-center gap-3 border-one-line border-b px-3 py-2">
        <button
          type="button"
          onClick={onLeave}
          className="min-h-11 px-1 text-[13px] text-one-muted"
        >
          ← Decks
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px]">parked</span>
        <span className="text-[11px] text-one-muted uppercase tracking-wider">
          {rows.length} parked
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {texts === null && failed === null && (
          <p className="text-one-muted text-[13px]">Reading the notes…</p>
        )}

        {texts !== null && rows.length === 0 && (
          <p className="text-one-muted text-[13px]">
            Nothing parked. A card leaves the review when you write{" "}
            <span className="text-one-fg">!suspended</span> beside it, or when its answer is not
            written yet.
          </p>
        )}

        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={`${row.note}:${row.at}`} className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpen(row.note)}
                // Deliberately not `data-deck`, which is the selector the pane's
                // deck keys query.
                data-parked={`${row.note}:${row.at}`}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded border border-one-line px-3 py-2 text-left hover:border-one-accent"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{row.front}</span>
                <span className="text-[12px] text-one-muted">{row.deck}</span>
                <span className="text-[12px] text-one-muted opacity-60">{row.reason}</span>
              </button>
            </li>
          ))}
        </ul>

        {failed !== null && (
          <p role="alert" className="mt-6 text-one-muted">
            The note could not be read: {failed}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The rows the notes describe, in the order the notes were named.
 *
 * Two filters. A card in no deck at all is no card, which is `review.ts`'s own
 * rule, so a stray `::` in a note nobody tagged never arrives as an unanswered
 * row. And a note reviewed as one thing yields no cards from `parseCards`, so a
 * parked one is read off its frontmatter and drawn under its own name.
 */
function rowsOf(texts: Map<string, string>): ParkedRow[] {
  return [...texts].flatMap(([note, text]) => {
    const name = noteName(note);
    const cards = parseCards(text, name).flatMap((card, at) =>
      card.parked === null || card.decks.length === 0
        ? []
        : [{ note, at, front: card.front, deck: card.decks[0] ?? name, reason: card.parked }],
    );
    if (cards.length > 0) return cards;
    return readNoteSuspended(text)
      ? [{ note, at: 0, front: name, deck: name, reason: "suspended" as const }]
      : [];
  });
}
