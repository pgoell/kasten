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

/**
 * Whether the line is the token's own, which parks the card written above it.
 *
 * Stricter than `suspended`, and a different question. A card written over
 * several lines carries the token at the head of the line under its back, so a
 * line that opens with it belongs to that card and is no part of the answer.
 */
export function parks(line: string | undefined): boolean {
  return line?.trimStart().startsWith(SUSPEND_TOKEN) ?? false;
}

/** The token where it opens a line, with the space after it and not the indent. */
const HEAD_TOKEN = /^([ \t]*)!suspended[ \t]*/;

/**
 * `line` with the token it opens taken off, the indent kept.
 *
 * The twin of `withoutToken` and a different job. That one takes the token out
 * of an answer, so it eats the space before it; this one takes it off the line
 * it owns, so it eats the space after it and what is left is the schedule, or
 * nothing at all.
 */
export function withoutHeadToken(line: string): string {
  return line.replace(HEAD_TOKEN, "$1");
}

/** `text` with the token taken off, which is how a parked card is shown. */
export function withoutToken(text: string): string {
  return text.replace(TOKEN, "").trimEnd();
}

/**
 * The comment holding a card's schedule, wherever on the line it sits.
 *
 * Here rather than in `srs.ts` because both readers have to take it off a back
 * before showing one, and two copies of this expression is two chances to
 * disagree about what a card's answer is. `!` is obsidian-spaced-repetition's
 * and is matched rather than assumed, so a comment written without one is left
 * alone instead of read as a card nobody has answered.
 */
export const SR = /<!--SR:!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->/;

/** The two halves of a card written on one line, or null where the line is no card. */
export interface Divided {
  front: string;
  back: string;
}

/**
 * A card written on one line, split at its divider.
 *
 * The first `::` divides it, so an answer holding one of its own keeps it. The
 * schedule and the token come off the back, both being the format around the
 * card rather than part of the answer.
 *
 * An empty back comes back empty rather than as null. A question with no answer
 * under it is a card somebody wrote to answer later, which is a state and not a
 * non-card, and telling the two apart is the whole reason both readers call
 * this instead of each deciding for themselves.
 */
export function divide(line: string): Divided | null {
  const at = line.indexOf("::");
  if (at === -1) return null;
  return {
    front: line.slice(0, at).trim(),
    back: withoutToken(line.slice(at + 2).replace(SR, "")).trim(),
  };
}
