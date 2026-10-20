import type { Rating } from "@/lib/srs";

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
export const BUTTON =
  "min-h-11 rounded border border-one-line px-4 py-2 text-[13px] text-one-fg " +
  "hover:border-one-accent hover:text-one-accent active:bg-one-panel disabled:opacity-50 aria-disabled:opacity-50";

/** The footer under a card: the reveal, the typed answer, or the four ratings. */
export function ReviewAnswer({
  shown,
  typing,
  typed,
  onTyped,
  undoing,
  onReveal,
  onRate,
}: {
  shown: boolean;
  typing: boolean;
  typed: string;
  onTyped(t: string): void;
  undoing: boolean;
  onReveal(): void;
  onRate(r: Rating): void;
}) {
  return (
    <footer className="border-one-line border-t p-3">
      {shown ? (
        <div className="grid grid-cols-4 gap-2">
          {RATINGS.map(({ rating, label }) => (
            <button
              key={rating}
              type="button"
              onClick={() => onRate(rating)}
              disabled={undoing}
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
            onReveal();
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
            onChange={(event) => onTyped(event.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded border border-one-line bg-transparent px-3 text-[15px] text-one-fg outline-none focus:border-one-accent pointer-coarse:text-base"
          />
          {/* Submitting the form is what the phone keyboard's Go key does. */}
          <button type="submit" disabled={undoing} className={BUTTON}>
            Check
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={onReveal}
          aria-disabled={undoing}
          className={`${BUTTON} w-full`}
        >
          Show answer
        </button>
      )}
    </footer>
  );
}
