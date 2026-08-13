import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchNote, saveNote } from "@/lib/api";
import { readClock } from "@/lib/clock";
import type { Deck } from "@/lib/review";
import { type Card, nextSchedule, parseCards, type Rating, writeSchedule } from "@/lib/srs";

/** The four ratings, in the order they are drawn and keyed. */
const RATINGS: { rating: Rating; label: string }[] = [
  { rating: "again", label: "Again" },
  { rating: "hard", label: "Hard" },
  { rating: "good", label: "Good" },
  { rating: "easy", label: "Easy" },
];

/**
 * A tap target big enough for a thumb.
 *
 * 44px is the smallest square Apple and Google both call reachable, and the
 * whole point of this screen is that it works on a phone. Every button here
 * carries it, including the ones a desktop would be happy to draw smaller.
 */
const BUTTON =
  "min-h-11 rounded border border-one-line px-4 py-2 text-[13px] text-one-fg " +
  "hover:border-one-accent hover:text-one-accent active:bg-one-panel";

interface ReviewSessionProps {
  deck: Deck;
  /** Leave the session, which is the back button and the pane's `q`. */
  onLeave: () => void;
  /**
   * Handed the callbacks a shell may want to put its own keys over.
   *
   * The pane binds `space` and `1` to `4` to these; the phone route binds
   * nothing, its buttons being the whole interface. Neither shell holds a rule
   * about scheduling, which is what keeps the two from drifting.
   */
  onControls?: (controls: { reveal: () => void; rate: (rating: Rating) => void } | null) => void;
}

/**
 * One deck, one card at a time.
 *
 * The note is read once, at the start, and every rating is written straight
 * back to it. That is a `PUT` per answer, which is what the todo pane already
 * does per press, and it means a session interrupted halfway keeps the answers
 * it got rather than losing them the way a sitting of an exam does.
 *
 * The queue holds ordinals into the note's cards rather than the cards
 * themselves. Writing a schedule can insert a line, which moves every card
 * under it, but it can never add or remove a card, so card three stays card
 * three and the ordinals survive a rewrite that the line numbers do not.
 */
export function ReviewSession({ deck, onLeave, onControls }: ReviewSessionProps) {
  const [text, setText] = useState<string | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const today = useMemo(() => readClock(new Date()).date, []);

  useEffect(() => {
    let live = true;
    void fetchNote(deck.note).then(
      (note) => {
        if (!live) return;
        setText(note);
        const cards = parseCards(note);
        // Due first, then the ones nobody has answered, each in the note's
        // order. Nothing is shuffled: a deck written in an order was written in
        // that order on purpose, and an import arrives in the order Anki held.
        const due = cards.flatMap((card, at) => (isDue(card, today) ? [at] : []));
        const fresh = cards.flatMap((card, at) => (card.held === null ? [at] : []));
        setQueue([...due, ...fresh]);
      },
      (error: unknown) => {
        if (live) setFailed(error instanceof Error ? error.message : "could not read the note");
      },
    );
    return () => {
      live = false;
    };
  }, [deck.note, today]);

  const cards = useMemo(() => (text === null ? [] : parseCards(text)), [text]);
  const at = queue[0];
  const card = at === undefined ? undefined : cards[at];

  const rate = useCallback(
    (rating: Rating) => {
      if (text === null || at === undefined) return;
      const held = cards[at];
      if (held === undefined) return;

      const next = writeSchedule(text, held, nextSchedule(held.held, rating, today));
      setText(next);
      setShown(false);
      setDone((count) => count + 1);
      // `again` sends the card to the back rather than out of the queue, which
      // is the one place the session disagrees with the schedule it just wrote:
      // the note says tomorrow, and today's sitting asks once more.
      setQueue((held_) => (rating === "again" ? [...held_.slice(1), at] : held_.slice(1)));

      void saveNote(deck.note, next).then(
        () => {
          void queryClient.invalidateQueries({ queryKey: ["cards"] });
        },
        (error: unknown) => {
          // The answer is not lost with the write. The session carries on and
          // the bar says the note is the part that failed, because a rating
          // that vanished silently would be a card you answer again tomorrow
          // believing you had not.
          setFailed(error instanceof Error ? error.message : "could not write the note");
        },
      );
    },
    [at, cards, deck.note, queryClient, text, today],
  );

  const reveal = useCallback(() => {
    setShown(true);
  }, []);

  useEffect(() => {
    onControls?.(card === undefined ? null : { reveal, rate });
    return () => onControls?.(null);
  }, [card, onControls, rate, reveal]);

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
        <span className="min-w-0 flex-1 truncate text-[13px]">{deck.name}</span>
        <span className="text-[11px] text-one-muted uppercase tracking-wider">
          {queue.length} left
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-6 text-[15px]">
        {text === null && failed === null && <p className="text-one-muted">Reading the deck…</p>}

        {card === undefined && text !== null && (
          <div data-testid="review-done">
            <p>Nothing left in {deck.name}.</p>
            <p className="mt-2 text-one-muted">{done} answered.</p>
          </div>
        )}

        {card !== undefined && (
          <div data-testid="review-card">
            <p className="whitespace-pre-wrap">{card.front}</p>
            {shown && (
              <p
                data-testid="review-back"
                className="mt-6 whitespace-pre-wrap border-one-line border-t pt-6 text-one-accent"
              >
                {card.back}
              </p>
            )}
          </div>
        )}

        {failed !== null && (
          <p role="alert" className="mt-6 text-one-muted">
            The note could not be written: {failed}
          </p>
        )}
      </div>

      {card !== undefined && (
        <footer className="border-one-line border-t p-3">
          {shown ? (
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map(({ rating, label }) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => rate(rating)}
                  className={BUTTON}
                  data-rating={rating}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <button type="button" onClick={reveal} className={`${BUTTON} w-full`}>
              Show answer
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

/** Whether the card is one today's sitting should ask. */
function isDue(card: Card, today: string): boolean {
  return card.held !== null && card.held.due <= today;
}
