/**
 * A passage out of a book, as the note carries it.
 *
 * The whole format lives here, so the exact text of a note is one function's
 * answer and PR 6 has one place to read it back from. Pure, and the id is an
 * argument rather than minted inside: a function with a random number in it
 * cannot be tested against exact text.
 */

import { unescapeParagraph } from "@/lib/html-take";
import { encodePath } from "@/lib/note-path";
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
 *
 * Exported for the finder, which collapses a quote with it before searching the
 * book: one function is what makes the two sides provably the same rule rather
 * than two rules that happen to agree.
 */
export function collapse(text: string): string {
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
  /**
   * The vault path of the figure the selection held, where it held one.
   *
   * A path and never the `blob:` URL the book carries the picture at: the pane
   * puts the file in the vault before it reports the passage, so by the time
   * this is written the note can point at something that outlives the reader.
   */
  image?: string;
  /**
   * Kasten's own link for the anchor line, written as it is before the chapter
   * words: a video take's time link. Never text from the page or the book, which
   * goes in `chapter` and through the escape.
   */
  link?: string;
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

  // Above the quote, because a book's caption sits under its figure and the
  // quote is usually that caption. Encoded for the reason the paste writes one:
  // a space in `99 Misc` ends a markdown destination that is not encoded.
  const picture = passage.image === undefined ? "" : `![](${encodePath(passage.image)})`;

  // The leading newline is the caller's to supply: no branch of `appendUnder`
  // puts a blank line in front of the block, so this is the gap between the
  // heading and the quote and between one highlight and the next. The filter is
  // what lets a figure taken with no words be the whole block, and a quote
  // taken with no figure stay the three lines it always was.
  const body = [picture, quote].filter((part) => part !== "").join("\n\n");
  // Without a link the anchor is the chapter alone, leading space and all, as it
  // always was: the old notes are read back by the same reader and must match.
  const chapter = collapse(passage.chapter);
  const anchor =
    passage.link === undefined
      ? chapter
      : [passage.link, chapter].filter((part) => part !== "").join(" ");
  const block = `\n${body}\n\n${anchor} ^${id}`;
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
 *
 * Not unescaped here: `HighlightBlock` keeps the quote both ways, since a
 * highlight written before the escape existed holds the book's own backslashes.
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
  /**
   * The quote's paragraphs as the book should hold them: the note's words with
   * the take's escape read back. What the page shows.
   */
  quote: string[];
  /**
   * The quote's paragraphs as the note holds them, escape and all. A passage
   * written before the escape existed is the book's own words, so the book may
   * hold this and not `quote`; `findWritten` tries both.
   */
  raw: string[];
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

    const raw = paragraphs(lines.slice(first, index - 1));
    // A run edited down to a lone `>` leaves no paragraph, which is a question
    // the finder should never be asked.
    if (raw.length === 0) continue;
    const quote = raw.map(unescapeParagraph);
    blocks.push({ id: anchor[1] as string, quote, raw, from: first + 1, to: index + 1 });
  }

  return blocks;
}

/**
 * The quote, as written, of the block `line` sits in, or null outside one. As
 * written, so `findWritten` can read it back and try the book's own words too.
 *
 * All of `note` is scanned, measured at 0.2ms on a note holding two hundred
 * highlights. A reader that walked out from the cursor instead would need the
 * block rule written twice; `mayBeHighlightLine` is how the editor hands this
 * less than a whole note.
 */
export function highlightAt(note: string, line: number): string[] | null {
  return highlightBlocks(note).find((block) => line >= block.from && line <= block.to)?.raw ?? null;
}

/**
 * Whether `line` could be one of a block's lines: a quote line, the blank line
 * under the quote, or an anchor.
 *
 * What lets a caller hand `highlightAt` only the run of such lines around the
 * cursor rather than the whole note (#638). Every block lies inside one run,
 * and a run starts below a line that is no quote, so the reader finds the same
 * blocks in it that it finds in the note.
 */
export function mayBeHighlightLine(line: string): boolean {
  return line.startsWith(">") || line.trim() === "" || ANCHOR.test(line);
}
