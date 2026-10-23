import { useEffect, useRef } from "react";
import type { TocRow } from "@/components/book-contents";
import type { HighlightBlock } from "@/lib/highlight";

/** A column's heading, muted and small, the way the pdf pane labels its header. */
const LABEL = "shrink-0 px-3 pt-2 pb-1 font-sans text-k-12 tracking-wide text-k-muted uppercase";

/**
 * A row of either column, the full width of its column.
 *
 * `k-row` is the press feedback every list gets (`data-pressed`). The 44 px
 * height is for a finger; a mouse keeps the row it had.
 */
const ROW = "k-row block w-full text-left pointer-coarse:min-h-11";

interface ContentsColumnProps {
  rows: TocRow[];
  /** The id of the chapter the reader is in, or undefined where the book names none. */
  current: number | undefined;
  /** A click on a row that has somewhere to go. */
  onGo: (href: string) => void;
}

/**
 * The book's chapters down the left of the pane, the one the reader is in marked.
 *
 * The list scrolls on its own, and keeps the marked row in view as the reader
 * turns into another chapter. Rows are buttons, so Tab reaches them.
 */
export function ContentsColumn({ rows, current, onGo }: ContentsColumnProps) {
  const list = useRef<HTMLDivElement>(null);

  // The marked row moves when the chapter does, and a long contents would
  // otherwise leave it off the bottom of the column.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the trigger; the body reads the DOM's marked row, which the render has just moved.
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <nav
      aria-label="Book contents"
      className="flex min-h-0 w-56 shrink-0 flex-col border-r border-k-rule"
    >
      <span className={LABEL}>Contents</span>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {rows.map((row, index) => {
          // A row with no id never matches: the reader's chapter may have none either.
          const here = current !== undefined && row.id === current;
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: the rows are built with the book and never reorder, and a book may repeat both a label and an href.
              key={index}
              type="button"
              aria-current={here ? "true" : undefined}
              onClick={() => {
                if (row.href !== null) onGo(row.href);
              }}
              // The indent is the book's own nesting, as the overlay draws it.
              style={{ paddingLeft: `${0.75 + row.depth * 0.75}rem` }}
              className={`${ROW} truncate py-1.5 pr-3 font-sans text-k-13 ${
                here
                  ? "border-l-2 border-k-accent text-k-accent"
                  : "text-k-ink-soft hover:text-k-accent"
              }`}
            >
              {row.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface NoteColumnProps {
  /** Every passage the book's note holds, in the note's order. */
  blocks: HighlightBlock[];
  /** A click on a passage, which asks the book to go to it. */
  onSeek: (quote: string[]) => void;
}

/**
 * The passages taken so far, down the right of the pane.
 *
 * A click goes to the passage in the book. The list is the note's own, so a
 * take or a hand edit of the note shows here as it lands.
 */
export function NoteColumn({ blocks, onSeek }: NoteColumnProps) {
  return (
    <section
      aria-label="Taken"
      className="flex min-h-0 w-72 shrink-0 flex-col border-l border-k-rule"
    >
      <span className={LABEL}>Taken</span>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {blocks.length === 0 ? (
          <p className="px-3 py-2 font-sans text-k-13 text-k-muted">Nothing taken yet</p>
        ) : (
          blocks.map((block, index) => (
            <button
              // The id alone repeats when a block is copied by hand in the note, so the place is in the key too.
              // biome-ignore lint/suspicious/noArrayIndexKey: the place in the note is what tells two copies of one id apart; the list is rebuilt from the note whenever it changes.
              key={`${index}-${block.id}`}
              type="button"
              onClick={() => onSeek(block.raw)}
              className={`${ROW} px-3 py-2`}
            >
              <span className="line-clamp-3 font-serif text-k-15 text-k-ink">
                {block.quote.join(" ")}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
