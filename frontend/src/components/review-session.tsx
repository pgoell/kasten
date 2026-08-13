import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchNote, saveNote } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { noteBody } from "@/lib/note-frontmatter";
import type { Deck } from "@/lib/review";
import {
  type Card,
  nextSchedule,
  parseCards,
  type Rating,
  readNoteSchedule,
  sameAnswer,
  writeNoteSchedule,
  writeSchedule,
} from "@/lib/srs";

/**
 * Where the typing toggle is kept, which is the browser and not the vault.
 *
 * It is a preference about how you like to be asked, not a fact about the
 * notes, so it has no business in a file. The archive toggle makes the opposite
 * call and is deliberately not persisted at all; the difference is that
 * forgetting the archive is safe and forgetting this one is a small annoyance
 * on every card.
 */
const TYPING_KEY = "kasten.review.typing";

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
  const [revealed, setRevealed] = useState(false);
  const [typing, setTyping] = useState(() => localStorage.getItem(TYPING_KEY) === "on");
  /** What was typed for the card showing, kept so the verdict can quote it back. */
  const [typed, setTyped] = useState("");
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
        const cards = cardsOf(deck, note);
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
  }, [deck, today]);

  const cards = useMemo(() => (text === null ? [] : cardsOf(deck, text)), [deck, text]);
  const at = queue[0];
  const card = at === undefined ? undefined : cards[at];
  // A whole note has nothing hidden to show, so it is shown from the start and
  // the four ratings are the only thing its footer ever draws.
  const shown = revealed || card?.back === "";

  const rate = useCallback(
    (rating: Rating) => {
      if (text === null || at === undefined) return;
      const held = cards[at];
      if (held === undefined) return;

      const moved = nextSchedule(held.held, rating, today);
      const next = deck.whole ? writeNoteSchedule(text, moved) : writeSchedule(text, held, moved);
      setText(next);
      setRevealed(false);
      setTyped("");
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
    [at, cards, deck, queryClient, text, today],
  );

  const reveal = useCallback(() => {
    setRevealed(true);
  }, []);

  const toggleTyping = useCallback(() => {
    setTyping((on) => {
      localStorage.setItem(TYPING_KEY, on ? "off" : "on");
      return !on;
    });
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
        <button
          type="button"
          onClick={toggleTyping}
          aria-pressed={typing}
          className={`min-h-11 px-2 text-[11px] uppercase tracking-wider ${
            typing ? "text-one-accent" : "text-one-muted"
          }`}
        >
          Type
        </button>
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
            {shown && typing && (
              <p data-testid="review-verdict" className="mt-6 text-[13px] text-one-muted">
                {sameAnswer(typed, card.back) ? (
                  "Matched"
                ) : (
                  <>
                    You typed <span className="text-one-fg">{typed || "nothing"}</span>
                  </>
                )}
              </p>
            )}
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
          ) : typing ? (
            <form
              data-testid="review-typed"
              onSubmit={(event) => {
                event.preventDefault();
                reveal();
              }}
              className="flex gap-2"
            >
              <input
                // Off, both of them: an answer is a term of art as often as it
                // is a sentence, and a phone that capitalises and corrects it
                // marks you wrong for something you did not type.
                autoCapitalize="off"
                autoCorrect="off"
                aria-label="your answer"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                className="min-h-11 min-w-0 flex-1 rounded border border-one-line bg-transparent px-3 text-[15px] text-one-fg outline-none focus:border-one-accent"
              />
              {/* Submitting the form is what the phone keyboard's Go key does. */}
              <button type="submit" className={BUTTON}>
                Check
              </button>
            </form>
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

/**
 * What this deck asks, which is either the note's cards or the note itself.
 *
 * The one place the two kinds part company. A `#review` note becomes a single
 * card whose front is the note and whose back is nothing, so the queue, the
 * rating and the writing downstream are the same code for both, and only the
 * two lines here know there was ever a difference.
 */
function cardsOf(deck: Deck, text: string): Card[] {
  if (!deck.whole) return parseCards(text);
  const held = readNoteSchedule(text);
  return [{ from: 0, to: 0, front: noteBody(text).trim(), back: "", inline: false, held }];
}
