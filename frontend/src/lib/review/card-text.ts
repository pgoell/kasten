import { colons, unescaped } from "@/lib/review/card-line";

/** A ruby's reading and the parentheses around it, which are no part of the word. */
const READING = /<(rt|rp)\b[^>]*>.*?<\/\1>/g;

/** Ruby's own tags, left once the reading has gone. */
const RUBY_TAG = /<\/?ruby\b[^>]*>/g;

/**
 * An escape pair, a code span or a backtick run that closes none, leftmost
 * first, as `colons` reads them: `` \` `` opens no span.
 */
const TYPED = /\\[\s\S]|(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)|`+/g;

/**
 * A schedule comment or the import's marker with the backslash the import
 * gives it, in code too: either is read anywhere on a line (#351).
 */
const ESCAPED_COMMENT = /<!--(SR|anki)\\:/g;

/**
 * `code` with the backslash off each `ESCAPED_COMMENT`, which is no part of what Anki shows (#356).
 * Outside code markdown removes it itself; doing it here too would leave a comment drawn as none.
 */
function bareComments(code: string): string {
  return code.replace(ESCAPED_COMMENT, "<!--$1:");
}

/** A card side as `colons` reads it, each code span's comments bare. */
export function side(text: string): string {
  return colons(text).replace(TYPED, (found, ticks: string | undefined) =>
    ticks === undefined ? found : bareComments(found),
  );
}

/**
 * `target` as somebody types it: a ruby reading is a hint and not the answer, and an
 * imported `a&#58;&#58;b` is `a::b`. A code span keeps its text and backslashes (#346).
 */
export function typedTarget(target: string): string {
  return colons(target.replace(READING, "").replace(RUBY_TAG, "")).replace(
    TYPED,
    (found, ticks: string | undefined, code: string | undefined) =>
      ticks === undefined ? unescaped(found) : bareComments(code ?? ""),
  );
}

/**
 * Whether typed text counts as the answer. Forgiving on case, spacing and a stray full stop,
 * strict on words. No edit distance: a fuzzy match would call `Store` close to `Storage`.
 */
export function sameAnswer(typed: string, back: string): boolean {
  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, "");
  return plain(typed) !== "" && plain(typed) === plain(back);
}
