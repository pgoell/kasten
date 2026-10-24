import { useId } from "react";
import { intervalWords } from "@/lib/review-days";
import type { Rating } from "@/lib/srs";

/** The four ratings, in the order they are drawn and keyed. */
const RATINGS: { rating: Rating; label: string }[] = [
  { rating: "again", label: "Again" },
  { rating: "hard", label: "Hard" },
  { rating: "good", label: "Good" },
  { rating: "easy", label: "Easy" },
];

/**
 * The grade buttons: Again in the danger colour, Good outlined as the default, and
 * Hard and Easy quiet. Taller on a touch screen, where the thumb is the pointer:
 * 64 px, a thumb's target at the width four buttons share a phone.
 */
const GRADE_BASE =
  "min-h-11 pointer-coarse:min-h-16 rounded bg-k-paper text-k-15 hover:border-k-accent hover:text-k-accent active:bg-k-paper disabled:opacity-50";
// Good's outline is two pixels and the others one, so Good is marked by weight
// and not by a second hue beside Again's russet. Its padding gives back the extra
// pixel on each side, so all four buttons stand the same height.
const GRADE: Record<Rating, string> = {
  again: `${GRADE_BASE} border px-2 py-2 border-k-rule text-k-danger`,
  hard: `${GRADE_BASE} border px-2 py-2 border-transparent text-k-ink`,
  good: `${GRADE_BASE} border-2 px-[7px] py-[7px] border-k-accent text-k-ink`,
  easy: `${GRADE_BASE} border px-2 py-2 border-transparent text-k-ink`,
};

/**
 * A tap target big enough for a thumb.
 *
 * 44px is the smallest square Apple and Google both call reachable, and the
 * whole point of this screen is that it works on a phone. Every button here
 * carries it, including the ones a desktop would be happy to draw smaller.
 */
export const BUTTON =
  "min-h-11 rounded border border-k-rule px-4 py-2 text-k-13 text-k-ink " +
  "hover:border-k-accent hover:text-k-accent active:bg-k-paper disabled:opacity-50 aria-disabled:opacity-50";

/**
 * The footer under a card: the reveal, the typed answer, or the four ratings.
 *
 * The quiet links are the sitting's own, parking and the new question, and they
 * show on both sides. A whole note is always on its answer side, so a mouse
 * could not park it if they went with the reveal.
 */
export function ReviewAnswer({
  shown,
  typing,
  typed,
  onTyped,
  undoing,
  jotOpen,
  next,
  onReveal,
  onRate,
  onPark,
  onCapture,
}: {
  shown: boolean;
  typing: boolean;
  typed: string;
  onTyped(t: string): void;
  undoing: boolean;
  jotOpen: boolean;
  /** The days each rating would write for the card on screen, null where there is none. */
  next: Record<Rating, number> | null;
  onReveal(): void;
  onRate(r: Rating): void;
  onPark(): void;
  onCapture(): void;
}) {
  // The interval is drawn outside each button, so the button's name stays the
  // label, and this ties the two together for a screen reader.
  const id = useId();
  return (
    <footer className="border-k-rule border-t p-3">
      <div className="mx-auto w-full max-w-[var(--k-measure)]">
        {shown ? (
          <div className="grid grid-cols-4 gap-2">
            {RATINGS.map(({ rating, label }) => (
              <div key={rating} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => onRate(rating)}
                  disabled={undoing}
                  aria-describedby={`${id}-${rating}`}
                  data-rating={rating}
                  data-default={rating === "good" ? "" : undefined}
                  className={GRADE[rating]}
                >
                  {label}
                </button>
                <span id={`${id}-${rating}`} className="text-center text-k-12 text-k-muted">
                  {next === null ? "" : intervalWords(next[rating])}
                </span>
              </div>
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
              className="min-h-11 min-w-0 flex-1 rounded border border-k-rule bg-transparent px-3 text-k-15 text-k-ink outline-none focus:border-k-accent pointer-coarse:text-base"
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
            // Named outright, so the key hint inside is not read into the name.
            aria-label="Show the answer"
            className="flex min-h-11 w-full items-center justify-between rounded border border-k-rule bg-k-paper px-4 py-2 text-k-15 text-k-ink hover:border-k-accent hover:text-k-accent active:bg-k-paper aria-disabled:opacity-50"
          >
            Show the answer
            {/* A finger has no Space bar, so the hint is for the keyboard only. */}
            <kbd className="rounded border border-k-rule px-1.5 font-mono text-k-12 tracking-k-kbd text-k-muted pointer-coarse:hidden">
              Space
            </kbd>
          </button>
        )}
        <div className="mt-3 flex justify-center gap-6 text-k-13">
          <button
            type="button"
            onClick={onPark}
            aria-disabled={undoing}
            className="min-h-11 px-1 text-k-muted hover:text-k-accent aria-disabled:opacity-50 pointer-coarse:min-h-11"
          >
            Park this card
          </button>
          <button
            type="button"
            onClick={onCapture}
            aria-disabled={undoing}
            aria-expanded={jotOpen}
            className="min-h-11 px-1 text-k-muted hover:text-k-accent aria-disabled:opacity-50 pointer-coarse:min-h-11"
          >
            Write a new question
          </button>
        </div>
      </div>
    </footer>
  );
}

/**
 * Where the card came from, under its back: the note and line it is in, and how
 * long ago it was last answered.
 *
 * The link is the one way out to the source, which the card does not show. The
 * line is left off a whole note, which has no line to go to.
 */
export function ReviewSource({
  name,
  line,
  daysAgo,
  onOpen,
}: {
  /** The note's name, as the card's face calls it. */
  name: string;
  /** The line the card starts on, counted from one. Absent for a whole note. */
  line?: number;
  /** Days since the card was last answered, null for a card nobody has answered. */
  daysAgo: number | null;
  onOpen(): void;
}) {
  const where = line === undefined ? name : `${name}, line ${line}`;
  const when =
    daysAgo === null
      ? ""
      : daysAgo === 0
        ? ", last seen today"
        : daysAgo === 1
          ? ", last seen yesterday"
          : `, last seen ${daysAgo} days ago`;
  return (
    <p className="mt-6 font-sans text-k-13 text-k-muted">
      From{" "}
      <button
        type="button"
        onClick={onOpen}
        className="text-k-link underline-offset-2 hover:underline"
      >
        {where}
      </button>
      {when}
    </p>
  );
}
