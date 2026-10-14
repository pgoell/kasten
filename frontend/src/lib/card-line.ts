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

/**
 * A cloze's schedule, one per number and named by it: `<!--SR:c1!…-->`.
 *
 * The name sits between the colon and the `!`, which is what keeps the two
 * comments apart in both directions: `SR` wants the `!` straight after the
 * colon, and this wants a number before it. A cloze line can then carry its
 * numbers' comments in any order, and a plain card beside it never reads one.
 */
export const CLOZE_SR = /<!--SR:c(\d+)!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->/;

/** Every cloze comment on a line, for taking them all off a side before it is shown. */
const CLOZE_SRS = new RegExp(CLOZE_SR.source, "g");

/**
 * The comment of one number, the `!` after it what keeps `c1` off `c12`.
 *
 * Built per number rather than read off `CLOZE_SR`, because a rating rewrites
 * its own comment and no other, and a replace has to find that one.
 */
export function clozeComment(cloze: number): RegExp {
  return new RegExp(`<!--SR:c${cloze}!(\\d{4}-\\d{2}-\\d{2}),(\\d+),(\\d+)-->`);
}

/**
 * One cloze mark, `{{c1::text}}` or `{{c1::text::hint}}`.
 *
 * No brace inside, so a nested mark is not read as one long one; the doc says
 * nested marks are not read, and this is where that is true. Lazy, so the
 * second `::` is the hint's and a mark ends at the first `}}`.
 */
const MARK = /\{\{c(\d+)::([^{}]+?)(?:::([^{}]+?))?\}\}/g;

/**
 * The numbers the line's marks carry, ascending and each once.
 *
 * Ascending because the session addresses a card by its ordinal among its
 * note's cards, and a line's cards sort by the line alone: the order they are
 * pushed in is the order they keep, so it has to be the same on every read.
 */
export function clozeNumbers(line: string): number[] {
  const found = new Set([...line.matchAll(MARK)].map((mark) => Number(mark[1])));
  return [...found].sort((one, two) => one - two);
}

/** Whether the line is a cloze, which it is before it is anything else. */
export function holdsCloze(line: string | undefined): boolean {
  return line !== undefined && clozeNumbers(line).length > 0;
}

/** `line` with every schedule comment taken off, plain and labelled, and the token. */
function bare(line: string): string {
  return withoutToken(line.replace(CLOZE_SRS, "").replace(SR, "")).trim();
}

/** `line` with one number's marks drawn by `hidden` and every other number's as its text. */
function drawn(line: string, cloze: number, hidden: (text: string, hint?: string) => string) {
  return bare(line).replace(MARK, (_, number: string, text: string, hint?: string) =>
    Number(number) === cloze ? hidden(text, hint) : text,
  );
}

/**
 * The question this number asks: its text hidden as `[...]`, or as `[hint]`.
 *
 * The brackets escaped, because a front is markdown and the preview reads a
 * bare `[...]` as a link, hiding the brackets that make it read as a blank.
 */
export function clozeQuestion(line: string, cloze: number): string {
  return drawn(line, cloze, (_, hint) => `\\[${hint ?? "..."}\\]`);
}

/** The line as its sentence, every mark its plain text, which names a cloze as a whole. */
export function clozePlain(line: string): string {
  return drawn(line, 0, (text) => text);
}

/** The answer: the whole line, with this number's text highlighted. */
export function clozeAnswer(line: string, cloze: number): string {
  return drawn(line, cloze, (text) => `==${text}==`);
}

/** What typing the answer is compared against: this number's texts, joined. */
export function clozeTarget(line: string, cloze: number): string {
  return [...line.matchAll(MARK)]
    .filter((mark) => Number(mark[1]) === cloze)
    .map((mark) => mark[2] ?? "")
    .join(", ");
}

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
