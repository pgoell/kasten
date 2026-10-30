import { highlightBlocks } from "@/lib/highlight";

/** The picture `addHighlight` writes above a quote: `![](<path>)` alone on its line. */
const PICTURE = /^!\[\]\([^)]*\)$/;

/**
 * `note` with the highlight block whose anchor is `^${id}` taken out, or null when no block or more
 * than one carries that id. The blank line `addHighlight` put before the quote goes too.
 */
export function withoutHighlight(note: string, id: string): string | null {
  const blocks = highlightBlocks(note).filter((block) => block.id === id);
  const [block] = blocks;
  // Two of one id are refused rather than guessed at: which one is the take?
  if (block === undefined || blocks.length !== 1) return null;

  const lines = note.split("\n");
  const first = block.from - 1;
  // The blank line `addHighlight` put in front of the quote goes with the block. A figure
  // taken with the quote sits above that blank, so it goes too, with the blank in front of it.
  let start = lines[first - 1] === "" ? first - 1 : first;
  if (start < first && PICTURE.test(lines[start - 1] ?? "")) {
    start -= 1;
    if (lines[start - 1] === "") start -= 1;
  }
  return [...lines.slice(0, start), ...lines.slice(block.to)].join("\n");
}
