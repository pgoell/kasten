/**
 * Where a note's quotes sit in a section of the book.
 *
 * A highlight is found again by searching the section on screen for the words
 * it quotes, which is the whole anchor. foliate's own search would do it and
 * costs five thousand times as much on the same section, measured: it slides a
 * grapheme window and asks an `Intl.Collator` at every position, while this
 * builds one collapsed string per document and calls `indexOf`.
 */

import { textWalker } from "foliate-js/text-walker.js";
import { collapse } from "@/lib/highlight";

/** Positions in the walker's own strings, back into a `Range`. */
type MakeRange = (
  startIndex: number,
  startOffset: number,
  endIndex: number,
  endOffset: number,
) => Range;

/**
 * What foliate's walker hands the caller, which is all this asks of it.
 *
 * Named here rather than reached for through the library's own types, which it
 * ships none of, the way `book-pane.tsx` names `FoliateView`.
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
 * One string out of the whole document, every run of whitespace one space.
 *
 * `\s` and not a hand written class: that is what the writer collapses a quote
 * with and what foliate collapses the book with, non-breaking space in both.
 * The leading run is dropped, and the trailing one never shows: both ends of a
 * quote are non-whitespace, `collapse` having trimmed them.
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
 * Where `quote`'s paragraphs run in `text`, as a half open pair, or null.
 *
 * The one rule for what it means for something to hold a quote. `locate` below
 * turns the answer into a range for drawing, and `holdsQuote` asks the question
 * of a page nothing has drawn yet, and the point of the shared function is that
 * `gf` cannot take you somewhere the draw pass then refuses to mark.
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
 * Whether `text` holds every paragraph of `quote`, in the order the note has them.
 *
 * For a page whose words can be had without drawing it, which is a pdf's:
 * `findQuotes` needs a document and a pdf page has none until it is rendered.
 * The text is collapsed here rather than by the caller, so the caller may hand
 * over whatever the format gave it.
 */
export function holdsQuote(text: string, quote: string[]): boolean {
  return span(collapse(text), quote) !== null;
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
 * Where each quote sits in `doc`, in the order asked, null for one it does not hold.
 *
 * Every quote at once, and the signature is what keeps the walk single: the
 * document is walked once, one string is built out of its text nodes, and every
 * quote is looked for in that one string. Measured on the biggest section of a
 * real book, 3.0ms for two hundred quotes in one walk against 638ms for two
 * hundred walks, so a friendlier `findQuote(doc, quote)` is not what this
 * exports.
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
