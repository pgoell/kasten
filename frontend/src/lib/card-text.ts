import { colons, unescaped } from "@/lib/card-line";

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
 * `code` with the backslash off each `ESCAPED_COMMENT`, the one escape a code
 * span holds: it is no part of what Anki shows (#356). Outside code markdown
 * takes it off itself, and doing it there would leave a comment drawn as none.
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
 * `target` as somebody types it: an imported `<ruby>漢字<rt>かんじ</rt></ruby>`
 * is the word `漢字`, the reading drawn over it being a hint and not the answer.
 *
 * An imported `a&#58;&#58;b` is `a::b` too, and `a\\-b` is `a\-b`, as `colons` and `unescaped` give them.
 * A code span is its text as written, since nobody types the backticks (#346),
 * and keeps its backslashes, as markdown reads no escape there, all but
 * `bareComments`'s.
 */
export function typedTarget(target: string): string {
  return colons(target.replace(READING, "").replace(RUBY_TAG, "")).replace(
    TYPED,
    (found, ticks: string | undefined, code: string | undefined) =>
      ticks === undefined ? unescaped(found) : bareComments(code ?? ""),
  );
}

/**
 * Whether what was typed counts as the card's answer.
 *
 * Forgiving on everything that is not the answer: case, the space around and
 * inside it, and a full stop the card's author typed and you did not. Not
 * forgiving on a word, because a card whose answer is nearly right is a card
 * you are about to rate yourself, and this only says which way to lean.
 *
 * ponytail: no edit distance. A typo you can see is a typo you can rate `hard`,
 * and a threshold that called `Store` close enough to `Storage` would be worse
 * than the strict answer, not better.
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
