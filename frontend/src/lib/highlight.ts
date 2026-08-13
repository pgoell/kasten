/**
 * A passage out of a book, as the note carries it.
 *
 * The whole format lives here, so the exact text of a note is one function's
 * answer and PR 6 has one place to read it back from. Pure, and the id is an
 * argument rather than minted inside: a function with a random number in it
 * cannot be tested against exact text.
 */

import { appendUnder } from "@/lib/note-section";

/** The heading a highlight lands under, made on first write. */
const HIGHLIGHTS = "## Highlights";

/**
 * One run of whitespace to one space, and the ends cut off.
 *
 * JavaScript's `\s`, which is the class foliate's own search normalises the
 * book with before matching (`search.js:81`), non-breaking space included in
 * both. PR 6 finds a highlight by searching the book for its words, so the two
 * sides have to agree on the character class.
 */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A passage taken out of the book: what was selected, and where from. */
export interface Passage {
  /** What `selection.toString()` answered, unformatted. */
  text: string;
  /**
   * The chapter line's words, as the pane found them: the toc label, or the
   * fallback where there was none. Unformatted, the way `text` is.
   */
  chapter: string;
}

/**
 * `note` with `passage` written in under `## Highlights`, minting the section
 * where there is none. `id` is the whole anchor id, `hl-` and six hex, and this
 * writes `^${id}`.
 */
export function addHighlight(note: string, passage: Passage, id: string): string {
  // A lone `>` between the paragraphs and not a blank line: a blank line ends
  // the blockquote, which would leave the second paragraph as prose sitting
  // under the first.
  const quote = passage.text
    .split(/[\r\n]+/)
    .map(collapse)
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => `> ${paragraph}`)
    .join("\n>\n");

  // The leading newline is the caller's to supply: no branch of `appendUnder`
  // puts a blank line in front of the block, so this is the gap between the
  // heading and the quote and between one highlight and the next.
  const block = `\n${quote}\n\n${collapse(passage.chapter)} ^${id}`;
  return appendUnder(note, HIGHLIGHTS, block);
}

/**
 * The anchor line's own test: the chapter words, then `^hl-` and six hex.
 *
 * Lowercase because that is what `newId` mints, `toString(16)` answering
 * lowercase. Trailing whitespace is ignored; an id retyped in capitals is not
 * an id, which is the same rule as one mistyped.
 */
const ANCHOR = /\^(hl-[0-9a-f]{6})\s*$/;

/**
 * The quoted run read back into the paragraphs it was written from.
 *
 * The strip and the break on an empty line are the exact inverse of the writer,
 * which leaves each paragraph on one line with single spaces in it. The join
 * and the `collapse` are more than that, and both are deliberate: a note
 * somebody hand wrapped reads as markdown reads it, one paragraph, and a hand
 * doubled space would otherwise never match the book. Both are the identity on
 * anything the writer wrote.
 */
function paragraphs(run: string[]): string[] {
  const groups: string[][] = [[]];
  for (const line of run) {
    // Trimmed before the test, so a separator line a hand edit left spaces on
    // parts two paragraphs rather than merging them.
    const stripped = line.replace(/^> ?/, "").trim();
    if (stripped === "") groups.push([]);
    else groups[groups.length - 1]?.push(stripped);
  }

  return groups.map((group) => collapse(group.join(" "))).filter((quote) => quote !== "");
}

/** One highlight as the note carries it, and where its lines are. */
export interface HighlightBlock {
  /** The anchor id, `hl-` and six hex, which is what the overlay is keyed by. */
  id: string;
  /** The quote's paragraphs, as the book should hold them. */
  quote: string[];
  /** The first and last line of the block, counting from one, the way CodeMirror does. */
  from: number;
  to: number;
}

/**
 * Every highlight block in `note`, in the order it holds them.
 *
 * The anchor line is the whole of the third test, and the `## Highlights`
 * heading is never looked for: a block somebody moved elsewhere in the note is
 * still a highlight. Requiring the anchor is also what keeps `<CR>` moving down
 * a plain blockquote, Enter reaching the same reader `gf` does.
 */
export function highlightBlocks(note: string): HighlightBlock[] {
  const lines = note.split("\n");
  const blocks: HighlightBlock[] = [];

  for (const [index, line] of lines.entries()) {
    const anchor = ANCHOR.exec(line);
    if (anchor === null) continue;
    // A line of spaces left by a hand edit counts as blank, the way
    // `appendUnderEdit` reads one when it walks back over it.
    if (index < 2 || lines[index - 1]?.trim() !== "") continue;

    let first = index - 1;
    while (first > 0 && lines[first - 1]?.startsWith(">")) first -= 1;
    if (first === index - 1) continue;

    const quote = paragraphs(lines.slice(first, index - 1));
    // A run edited down to a lone `>` leaves no paragraph, which is a question
    // the finder should never be asked.
    if (quote.length === 0) continue;
    blocks.push({ id: anchor[1] as string, quote, from: first + 1, to: index + 1 });
  }

  return blocks;
}

/**
 * The quote of the block `line` sits in, or null outside one.
 *
 * The whole note is scanned on every press, measured at 0.2ms on a note holding
 * two hundred highlights. A reader that walked out from the cursor instead would
 * be faster and would need the block rule written twice.
 */
export function highlightAt(note: string, line: number): string[] | null {
  return (
    highlightBlocks(note).find((block) => line >= block.from && line <= block.to)?.quote ?? null
  );
}
