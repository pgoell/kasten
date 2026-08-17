/**
 * What makes a line a card the sitting will ask.
 *
 * The sibling of `deck-tag.ts` and here for the same reason. Two readers of this
 * format have to agree and they read different things: `review.ts` counts off
 * the lines one rg pass matched, `srs.ts` parses a note whole. Every rule they
 * could disagree about belongs in one file both import, and the disagreements
 * this one settles were real before it existed.
 */

/** Which lines sit inside a fenced code block, so `std::vector` is not a card. */
export function fences(lines: string[]): boolean[] {
  let inside = false;
  return lines.map((line) => {
    if (line.trimStart().startsWith("```")) {
      inside = !inside;
      // The fence itself is never a card either way.
      return true;
    }
    return inside;
  });
}
