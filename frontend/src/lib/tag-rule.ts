/**
 * The one rule every reader in the frontend reads a `#tag` by, which
 * `docs/reference/tag-format.md` states and `tag-cases.json` tests.
 *
 * Its own module, and one that imports nothing, so the editor's parser, the todo
 * pane and the flashcard decks can share it. `todo.ts` and `deck-tag.ts` once
 * kept copies of the editor's pattern rather than pull CodeMirror in with
 * `tag.ts`, and the copies drifted apart.
 */

/** What a tag is made of: a letter, a number, `_`, `-` or `/`. */
export const TAG_CHARS = String.raw`[\p{L}\p{N}_/-]`;

/**
 * `#` and a run of tag characters holding at least one that is not a number.
 *
 * Numbers alone make no tag, so `#1984` and `#½` stay words while `#1on1` and
 * `#2026-10-13-x` are tags. Any other character ends the run, so `(#next).`
 * carries `#next`.
 */
export const TAG_SOURCE = String.raw`#(?=${TAG_CHARS}*[\p{L}_/-])${TAG_CHARS}+`;

/** The tag a text opens with, for a reader that already stands on the hash. */
export const LEADING_TAG = new RegExp(`^${TAG_SOURCE}`, "u");

const TAGS = new RegExp(TAG_SOURCE, "gu");

/**
 * What may not sit in front of a hash, tested on the text before it: so
 * `note#2x`, `https://a.io/p#x` and `²#x` carry no tag.
 */
export const GLUED = /[\p{L}\p{N}_/]$/u;

/**
 * A link, a markdown link and a code span: a hash inside one is no tag, and a
 * todo's field marker inside one is no field.
 * Global, so use it through `matchAll` or `replace` only, never `exec`.
 */
export const SPANS = /\[\[[^[\]\n]+\]\]|\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]*`/g;

/**
 * `text` with every span blanked to the same length, so a marker inside one
 * matches nothing and every offset still lines up with the text. The filler
 * keeps the spaces and is a no-break space: no field, tag or block id reads it,
 * and neither `\S` nor `[ \t]` takes it, so a marker straight before a span has
 * no value and stays words rather than reading the span's first word.
 */
export function masked(text: string): string {
  return text.replace(SPANS, (span) => span.replace(/[^ \t]/g, " "));
}

/**
 * Every tag one line carries and where it starts. Found on the mask, so a hash
 * in a link or a code span is text, and read off the text.
 *
 * A line at a time, so it knows nothing of fences: a reader of a whole note
 * skips the fenced lines itself, as `srs.ts` does.
 */
export function tagsOf(text: string): { tag: string; at: number }[] {
  return [...masked(text).matchAll(TAGS)]
    .filter((found) => !GLUED.test(text.slice(0, found.index)))
    .map((found) => ({
      tag: text.slice(found.index, found.index + found[0].length),
      at: found.index,
    }));
}
