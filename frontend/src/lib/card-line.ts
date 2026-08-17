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

/** What parks a finished card by hand, written beside its schedule. */
export const SUSPEND_TOKEN = "!suspended";

/**
 * The token, at the head of a line or after a space, and whole.
 *
 * Whole so `!suspendedly` is a word and not a marker, and after a space so a
 * card asking what the token means keeps its answer. An answer that really does
 * end in the literal text is the one false positive left, and it is one the
 * author typed on purpose.
 */
const TOKEN = /(?:^|\s)!suspended(?!\S)/;

/** Whether this text carries the token that parks a card. */
export function suspended(text: string): boolean {
  return TOKEN.test(text);
}

/** `text` with the token taken off, which is how a parked card is shown. */
export function withoutToken(text: string): string {
  return text.replace(TOKEN, "").trimEnd();
}
