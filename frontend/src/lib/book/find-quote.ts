/**
 * Where a note's quotes sit in a section, found by searching the section for their words.
 * Measured about five thousand times cheaper than foliate's own search, which asks a collator at every position.
 */

import { textWalker } from "foliate-js/text-walker.js";
import { collapse } from "@/lib/highlight";
import { unescapeParagraph } from "@/lib/html-take";

/** Positions in the walker's own strings, back into a `Range`. */
type MakeRange = (
  startIndex: number,
  startOffset: number,
  endIndex: number,
  endOffset: number,
) => Range;

/**
 * What foliate's walker hands the caller. Named here, since foliate ships no types,
 * the way `lib/book/foliate-view.ts` names `FoliateView`.
 */
type TextWalker = <T>(
  doc: Document,
  read: (strings: string[], makeRange: MakeRange) => T[],
) => Generator<T>;

/** The document's text as one collapsed string, and where each character came from. */
interface Haystack {
  text: string;
  /** Which of the walker's strings the character at this position came from. */
  index: number[];
  /** Its offset in that string. A space standing for a run records the run's first character. */
  offset: number[];
}

/**
 * One string of a whole document, each run of whitespace one space. `\s`, not a hand-written
 * class, since the note's writer and foliate both collapse with it, non-breaking space included.
 */
function haystackOf(strings: string[]): Haystack {
  const characters: string[] = [];
  const index: number[] = [];
  const offset: number[] = [];

  for (const [at, string] of strings.entries()) {
    for (let position = 0; position < string.length; position += 1) {
      const character = string[position] as string;
      if (/\s/.test(character)) {
        if (characters.length === 0 || characters[characters.length - 1] === " ") continue;
        characters.push(" ");
      } else characters.push(character);
      index.push(at);
      offset.push(position);
    }
  }

  return { text: characters.join(""), index, offset };
}

/**
 * Where `quote`'s paragraphs run in `text`, as a start and end pair, or null. The one rule
 * for holding a quote: `gf` cannot send you somewhere the draw pass then refuses to mark.
 */
function span(text: string, quote: string[]): [number, number] | null {
  let from = -1;
  let to = 0;

  for (const paragraph of quote) {
    // Collapsed on this side too. They arrive collapsed already, the reader
    // having done it, and doing it here is what makes the two sides one rule
    // rather than two that happen to agree.
    const needle = collapse(paragraph);
    // Each paragraph from the end of the one before it, so the order the note
    // holds them is the order the book has to hold them. Greedy and it does not
    // back up: where a paragraph appears twice the first match is taken.
    const at = text.indexOf(needle, to);
    if (at === -1) return null;
    if (from === -1) from = at;
    to = at + needle.length;
  }

  return from === -1 ? null : [from, to];
}

/**
 * Whether `text` holds every paragraph of `quote`, in order. For a pdf page whose words can be
 * had without drawing it. Collapsed here, so the caller may pass the text as the format gave it.
 */
export function holdsQuote(text: string, quote: string[]): boolean {
  return span(collapse(text), quote) !== null;
}

/**
 * The book's words for a quote, the take's escape read back. A passage written before the escape
 * existed holds the book's own words, so the form as written is tried second.
 */
function readBack(written: string[]): string[] {
  return written.map(unescapeParagraph);
}

/** Whether `text` holds a quote as the note wrote it, read back or as written, for a pdf's `gf`. */
export function holdsWritten(text: string, written: string[]): boolean {
  return holdsQuote(text, readBack(written)) || holdsQuote(text, written);
}

/** The range covering `quote`'s paragraphs in `haystack`, or null for a paragraph it lacks. */
function locate(haystack: Haystack, quote: string[], makeRange: MakeRange): Range | null {
  const found = span(haystack.text, quote);
  if (found === null) return null;

  const [from, to] = found;
  const last = to - 1;
  return makeRange(
    haystack.index[from] as number,
    haystack.offset[from] as number,
    haystack.index[last] as number,
    (haystack.offset[last] as number) + 1,
  );
}

/**
 * Where each quote sits in `doc`, in the order asked, or null for one it does not hold.
 * One walk: 3ms for two hundred quotes, against 638ms walking once per quote.
 */
export function findQuotes(doc: Document, quotes: string[][]): Array<Range | null> {
  const walk = textWalker as TextWalker;
  const found = walk(doc, (strings, makeRange) => {
    const haystack = haystackOf(strings);
    return [quotes.map((quote) => locate(haystack, quote, makeRange))];
  }).next().value;

  // A document with no text nodes at all yields nothing, the walker's own loop
  // never running.
  return found ?? quotes.map(() => null);
}

/**
 * Where each passage sits in `doc`, as the note holds it, or null for one the book does not hold.
 * Tries the read-back form first, then the as-written form for a passage taken before the escape.
 */
export function findWritten(doc: Document, written: string[][]): Array<Range | null> {
  const found = findQuotes(doc, [...written.map(readBack), ...written]);
  return written.map((_, index) => found[index] ?? found[written.length + index] ?? null);
}
