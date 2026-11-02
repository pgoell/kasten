/**
 * The one rule every frontend reader uses for a `#tag`, as `docs/reference/tag-format.md` states
 * and `tag-cases.json` tests. It imports nothing, so the parser, todos and decks can share it.
 */

/** What a tag is made of: a letter, a number, `_`, `-` or `/`. */
export const TAG_CHARS = String.raw`[\p{L}\p{N}_/-]`;

/** `#` and tag characters holding at least one non-number: `#1984` is words, `#1on1` a tag. */
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
 * Links, code spans and same-line HTML comments, where a hash is no tag. Global, so use it
 * through `matchAll` or `replace` only, never `exec`. `todo_fields.SPANS` is the same pattern.
 */
export const SPANS = /\[\[[^[\]\n]+\]\]|\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]*`|<!--[^\n]*?-->/g;

/**
 * What opens an HTML block that may break a paragraph, CommonMark's kinds 1 to 6, with the
 * editor's block names. A lone tag, kind 7, may not, so only a whole-note reader places it.
 */
const HTML_OPENER = String.raw`<!--|<(?:script|pre|style)(?:\s|>|$)|<\?|<![a-z]|<!\[CDATA\[|<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)`;

/**
 * `SPANS`, plus an HTML block opening the line or a list item or quote on it, which takes the
 * line, so no tag follows it. Not after a box, which opens a plain paragraph.
 * `todos.BLOCK_OPENING` is the same pattern; each pass opens on a marker, or a line of `> `
 * would backtrack exponentially.
 */
const LINE_SPANS = new RegExp(
  String.raw`^ {0,3}(?:(?:>|(?:[-*+]|[0-9]{1,9}[.)])[ \t])[ \t]{0,4})*(?:${HTML_OPENER})[^\n]*|${SPANS.source}`,
  "gi",
);

/** `text` with every one of `spans` blanked to the same length. */
function blanked(text: string, spans: RegExp): string {
  return text.replace(spans, (span) => span.replace(/[^ \t]/g, "\u00A0"));
}

/**
 * `text` with every span blanked to the same length, so offsets still line up. The filler is a
 * no-break space, which `\S` and `[ \t]` skip, so a marker before a span stays words.
 */
export function masked(text: string): string {
  return blanked(text, SPANS);
}

/** The tags `mask` holds, read off `text`. */
function tagsOn(mask: string, text: string): { tag: string; at: number }[] {
  return [...mask.matchAll(TAGS)]
    .filter((found) => !GLUED.test(text.slice(0, found.index)))
    .map((found) => ({
      tag: text.slice(found.index, found.index + found[0].length),
      at: found.index,
    }));
}

/**
 * Every tag on one line and where it starts. A line at a time, so fences are unknown here:
 * a reader of a whole note skips fenced lines itself, as `srs.ts` does.
 */
export function tagsOf(text: string): { tag: string; at: number }[] {
  return tagsOn(blanked(text, LINE_SPANS), text);
}

/**
 * `tagsOf` for text that opens no line, the words after a todo's box or typed
 * into quick add, where a `<!--` in front is a comment and opens no block.
 */
export function wordTags(text: string): { tag: string; at: number }[] {
  return tagsOn(masked(text), text);
}
