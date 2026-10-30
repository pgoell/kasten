/**
 * A passage out of a book, as the note carries it. The whole format lives here. Pure: the id
 * is an argument, since random text cannot be tested exactly.
 */

import { unescapeParagraph } from "@/lib/html-take";
import { encodePath } from "@/lib/note-path";
import { appendUnder } from "@/lib/note-section";

/** The heading a highlight lands under, made on first write. */
const HIGHLIGHTS = "## Highlights";

/**
 * One run of whitespace to one space, and the ends cut off. Uses JavaScript's `\s`, the class
 * foliate's search normalises the book with (`search.js:81`), so the finder matches the same way.
 */
export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A passage taken out of the book: what was selected, and where from. */
export interface Passage {
  /** What `selection.toString()` answered, unformatted. */
  text: string;
  /** The chapter's words: its toc label, or the fallback. Unformatted, as `text` is. */
  chapter: string;
  /**
   * The figure's vault path, never the `blob:` URL: the pane saves the file before it reports
   * the passage, so the note outlives the reader.
   */
  image?: string;
  /** Kasten's own link (a video take's time link) for the anchor line. Never page or book text. */
  link?: string;
}

/**
 * Writes `passage` under `## Highlights` in `note`, making the section if there is none. `id` is
 * the full anchor id, `hl-` plus six hex, written as `^${id}`.
 */
export function addHighlight(note: string, passage: Passage, id: string): string {
  // A lone `>` between paragraphs: a blank line would end the blockquote.
  const quote = passage.text
    .split(/[\r\n]+/)
    .map(collapse)
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => `> ${paragraph}`)
    .join("\n>\n");

  // Above the quote, since a book's caption sits under its figure. Encoded: a space in the
  // path would end an unencoded markdown destination.
  const picture = passage.image === undefined ? "" : `![](${encodePath(passage.image)})`;

  // `appendUnder` adds no blank line, so the caller's leading newline is the gap. The filter lets
  // a figure with no words stand as the whole block.
  const body = [picture, quote].filter((part) => part !== "").join("\n\n");
  // No link: the anchor stays the bare chapter, as old notes were written; the reader matches them.
  const chapter = collapse(passage.chapter);
  const anchor =
    passage.link === undefined
      ? chapter
      : [passage.link, chapter].filter((part) => part !== "").join(" ");
  const block = `\n${body}\n\n${anchor} ^${id}`;
  return appendUnder(note, HIGHLIGHTS, block);
}

/**
 * The anchor line's test: `^hl-` and six lowercase hex at the end, as `newId` mints them.
 * Trailing whitespace is ignored; a capitalised id is not an id.
 */
const ANCHOR = /\^(hl-[0-9a-f]{6})\s*$/;

/**
 * The quoted run read back into paragraphs. The exact inverse of the writer; the join and
 * `collapse` also read a hand-wrapped note as markdown does. Not unescaped here: `HighlightBlock`
 * keeps both forms, since older highlights hold the book's own backslashes.
 */
function paragraphs(run: string[]): string[] {
  const groups: string[][] = [[]];
  for (const line of run) {
    // Trimmed first, so a hand-edited blank `>` line still splits paragraphs.
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
  /** The paragraphs as the book holds them, escape read back. What the page shows. */
  quote: string[];
  /** The paragraphs as the note holds them, escape included. `findWritten` tries both. */
  raw: string[];
  /** First and last line of the block, counted from one as CodeMirror counts. */
  from: number;
  to: number;
}

/**
 * Every highlight block in `note`, in order. The anchor line is the test, and the heading is
 * not looked for, so a moved block still counts. Requiring it keeps `<CR>` on plain quotes moving.
 */
export function highlightBlocks(note: string): HighlightBlock[] {
  const lines = note.split("\n");
  const blocks: HighlightBlock[] = [];

  for (const [index, line] of lines.entries()) {
    const anchor = ANCHOR.exec(line);
    if (anchor === null) continue;
    // Spaces-only lines count as blank, as `appendUnderEdit` reads them.
    if (index < 2 || lines[index - 1]?.trim() !== "") continue;

    let first = index - 1;
    while (first > 0 && lines[first - 1]?.startsWith(">")) first -= 1;
    if (first === index - 1) continue;

    const raw = paragraphs(lines.slice(first, index - 1));
    // A run edited to a lone `>` has no paragraph, and the finder must not be asked.
    if (raw.length === 0) continue;
    const quote = raw.map(unescapeParagraph);
    blocks.push({ id: anchor[1] as string, quote, raw, from: first + 1, to: index + 1 });
  }

  return blocks;
}

/**
 * The quote, as written, of the block `line` is in, or null outside one. All of `note` is
 * scanned: 0.2ms at two hundred highlights, and a walk from the cursor would need the rule twice.
 */
export function highlightAt(note: string, line: number): string[] | null {
  return highlightBlocks(note).find((block) => line >= block.from && line <= block.to)?.raw ?? null;
}

/**
 * Whether `line` could be part of a block: a quote line, the blank under it, or an anchor.
 * Callers pass `highlightAt` only the run of such lines around the cursor (#638).
 */
export function mayBeHighlightLine(line: string): boolean {
  return line.startsWith(">") || line.trim() === "" || ANCHOR.test(line);
}
