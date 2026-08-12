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
