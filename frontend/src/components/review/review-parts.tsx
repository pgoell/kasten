import type { ReactNode } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A `YYYY-MM-DD` in the words a heading uses: `Oct 19`. */
export function monthDay(date: string): string {
  const [, month = "1", day = "1"] = date.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)}`;
}

/** The days from `from` to `to`, both included. Counted in UTC, so no zone adds or drops one. */
export function daysBetween(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/** A section of a review: its heading and what it holds. */
export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="review-section">
      <h3 className="review-heading">{heading}</h3>
      {children}
    </section>
  );
}

/** The sentence under a chart, which says what it shows so it reads without its colours. */
export function Caption({ children }: { children: ReactNode }) {
  return <p className="review-caption">{children}</p>;
}

/** A line of words, as a section says what it has or has not got. */
export function Words({ children }: { children: ReactNode }) {
  return <p className="review-words">{children}</p>;
}

/**
 * What a section says while its read is still out. Not the empty words: an empty answer and an
 * answer not yet in look the same on the page, and a user reading "nothing" would believe it.
 */
export function Reading() {
  return <Words>Reading…</Words>;
}

/** A failed read's sentence, in the place its numbers would be. */
export function Failed({ message }: { message: string }) {
  return (
    <p role="alert" className="review-words">
      {message}
    </p>
  );
}

/** One number with its name: a big figure over a line of words. */
export function Tile({ label, figure, words }: { label: string; figure: string; words: string }) {
  return (
    <div className="review-tile">
      <p className="review-tile-label">{label}</p>
      <p className="review-figure">{figure}</p>
      <p className="review-words">{words}</p>
    </div>
  );
}
