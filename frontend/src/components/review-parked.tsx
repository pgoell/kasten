import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCards, fetchNote } from "@/lib/api";
import { clozePlain, unescaped } from "@/lib/card-line";
import { setSuspended } from "@/lib/card-write";
import { withoutTags } from "@/lib/deck-tag";
import { noteName } from "@/lib/note-path";
import { BACKOFF, readRetry, retryable } from "@/lib/read-retry";
import { parkedNotes } from "@/lib/review";
import { type Parked, parseCards } from "@/lib/srs";
import { readNoteSuspended, writeNoteSuspended } from "@/lib/srs-schedule";
import { useSittingWrites } from "@/lib/use-sitting-writes";

/** One row: a card the sitting will not ask, and where to find it again. */
interface ParkedRow {
  note: string;
  /** Its ordinal among the note's cards, the same address a Seat carries. */
  at: number;
  front: string;
  deck: string;
  reason: Parked;
  /** Whether the note is itself the card, which is parked in its frontmatter. */
  whole: boolean;
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
  /** A put-back whose write failed. A later read does not clear it: the write did not land. */
  const [failed, setFailed] = useState<string | null>(null);
  /** A read of the notes that failed, cleared by the next read that answers. */
  const [readFailed, setReadFailed] = useState<string | null>(null);
  const write = useSittingWrites(setTexts, setFailed);
  /** Per note, the writes out now. */
  const out = useRef(new Map<string, number>());
  /** Per note, the put-backs that landed, so a read can tell one landed while it was on its way. */
  const landed = useRef(new Map<string, number>());

  // The same key the overview holds, so opening this screen reads no cards the
  // list behind it has not already fetched.
  const { data: hits, error: hitsError } = useQuery({
    queryKey: ["cards", archive],
    queryFn: () => fetchCards(archive),
    ...readRetry,
  });
  // Out, or failed with nothing to read the notes by. Neither is an empty vault.
  const scanFailed = hits === undefined && hitsError !== null;

  const notes = useMemo(() => (hits === undefined ? [] : parkedNotes(hits)), [hits]);

  useEffect(() => {
    // Until the scan answers there is no list of notes to read, and reading none would show "Nothing parked.".
    if (hits === undefined) return;
    let live = true;
    const landedAt = new Map(landed.current);
    void Promise.all(
      notes.map(async (note) => [note, await readNote(note, () => live)] as const),
    ).then(
      (read) => {
        // A note with a write out, or a put-back that landed while this read was on its
        // way, keeps the text the screen holds: the read may predate that landing. A put-back
        // that failed left the vault as it was, so the read's text is then the truth.
        const busy = (note: string) =>
          (out.current.get(note) ?? 0) > 0 ||
          (landed.current.get(note) ?? 0) !== (landedAt.get(note) ?? 0);
        if (live) {
          setReadFailed(null);
          setTexts((was) =>
            was === null
              ? new Map(read)
              : new Map(
                  read.map(([note, text]) => [note, busy(note) ? (was.get(note) ?? text) : text]),
                ),
          );
        }
      },
      (error: unknown) => {
        if (live) setReadFailed(error instanceof Error ? error.message : "could not read the note");
      },
    );
    return () => {
      live = false;
    };
  }, [notes, hits]);

  const rows = useMemo(() => rowsOf(texts ?? new Map()), [texts]);

  /**
   * Take the token off and write the note, which returns the card to its deck.
   *
   * On the schedule it already held: parking never touched the three numbers,
   * so there is nothing to restore and nothing to guess.
   */
  function putBack(row: ParkedRow) {
    const text = texts?.get(row.note);
    if (text === undefined) return;

    let next: string;
    if (row.whole) next = writeNoteSuspended(text, false);
    else {
      const card = parseCards(text, noteName(row.note))[row.at];
      if (card === undefined) return;
      next = setSuspended(text, card, false);
    }

    setTexts((was) => new Map(was).set(row.note, next));
    tally(out.current, row.note, 1);
    void write(row.note, text, next).then((failure) => {
      tally(out.current, row.note, -1);
      if (failure === null) tally(landed.current, row.note, 1);
    });
  }

  return (
    <div className="flex h-full flex-col bg-k-bg font-mono text-k-ink">
      <header className="flex items-center gap-3 border-k-rule border-b px-3 py-2">
        <button type="button" onClick={onLeave} className="min-h-11 px-1 text-[13px] text-k-muted">
          ← Decks
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px]">parked</span>
        <span className="text-[11px] text-k-muted uppercase tracking-wider">
          {rows.length} parked
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {texts === null && failed === null && readFailed === null && !scanFailed && (
          <p className="text-k-muted text-[13px]">Reading the notes…</p>
        )}

        {texts !== null && rows.length === 0 && (
          <p className="text-k-muted text-[13px]">
            Nothing parked. A card leaves the review when you write{" "}
            <span className="text-k-ink">!suspended</span> beside it, or when its answer is not
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
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded border border-k-rule px-3 py-2 text-left hover:border-k-accent"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{row.front}</span>
                {/* A deck under two others is a name longer than a phone has
                    room for beside the question, and it would push through
                    the side of the row rather than shrink. */}
                <span className="text-[12px] text-k-muted max-md:max-w-[40%] max-md:truncate">
                  {row.deck}
                </span>
                <span className="text-[12px] text-k-muted opacity-60">{row.reason}</span>
              </button>
              {/* Only where there is a token to take off. A question with no
                  answer has none, and its answer is written in the editor,
                  which is what opening the row is for. */}
              {row.reason === "suspended" && (
                <button
                  type="button"
                  onClick={() => putBack(row)}
                  data-unpark={`${row.note}:${row.at}`}
                  className="min-h-11 rounded border border-k-rule px-3 text-[12px] text-k-muted hover:border-k-accent hover:text-k-accent"
                >
                  Put back
                </button>
              )}
            </li>
          ))}
        </ul>

        {scanFailed && (
          <p role="alert" className="mt-6 text-k-muted">
            The cards could not be read:{" "}
            {hitsError instanceof Error ? hitsError.message : "could not read the cards"}
          </p>
        )}

        {readFailed !== null && (
          <p role="alert" className="mt-6 text-k-muted">
            The note could not be read: {readFailed}
          </p>
        )}

        {failed !== null && (
          <p role="alert" className="mt-6 text-k-muted">
            The note could not be read: {failed}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Reads a note, trying again while the backend restarts, as `useSittingWrites` tries a write.
 * `live` says whether the effect that asked still stands, so a read it has left stops
 * before its next try.
 */
async function readNote(note: string, live: () => boolean): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchNote(note);
    } catch (error) {
      if (!retryable(error) || attempt === BACKOFF.length) throw error;
      await new Promise((wake) => setTimeout(wake, BACKOFF[attempt]));
      if (!live()) throw error;
    }
  }
}

/** Moves a note's count by `by`, from zero where the note has none yet. */
function tally(counts: Map<string, number>, note: string, by: number) {
  counts.set(note, (counts.get(note) ?? 0) + by);
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
    const lines = text.split("\n");
    const parsed = parseCards(text, name);
    const cards = parsed.flatMap((card, at) =>
      card.parked === null ||
      card.decks.length === 0 ||
      // One row per cloze and not per number: one token parks them all and
      // putting the first back puts every one back, so the others have no row
      // to stand for. The first number's ordinal is the row's address.
      (card.cloze !== null && parsed[at - 1]?.from === card.from)
        ? []
        : [
            {
              note,
              at,
              // A cloze named by its sentence, no number of it being the one asked.
              // Shown as text and not drawn, so markdown's escapes come off.
              front: unescaped(
                card.cloze === null ? card.front : clozePlain(withoutTags(lines[card.from] ?? "")),
              ),
              deck: card.decks[0] ?? name,
              reason: card.parked,
              whole: false,
            },
          ],
    );
    if (cards.length > 0) return cards;
    return readNoteSuspended(text)
      ? [{ note, at: 0, front: name, deck: name, reason: "suspended" as const, whole: true }]
      : [];
  });
}
