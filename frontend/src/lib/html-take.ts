/**
 * A passage a vault HTML page sends, written into today's `## Dump` as a quote. The page is not
 * trusted: every character that could open markup is escaped, and every line starts `> `, so
 * nothing the page sends can stand as a heading, a rule or a todo.
 */

import { collapse } from "@/lib/highlight";
import { noteSectionOf } from "@/lib/note-section";

/** What a page sends as the selection. */
export interface PagePassage {
  text: string;
  heading: string;
  anchor: string;
}

/** Characters of passage text kept, after collapsing, the ellipsis included. */
export const PASSAGE_CAP = 2000;

/** Characters of heading kept in the link's alias, the ellipsis included. */
export const HEADING_CAP = 120;

/** Paragraphs of passage kept, the rest dropped. */
const PARAGRAPH_CAP = 50;

/** Characters of anchor kept. */
const ANCHOR_CAP = 100;

/**
 * Control characters and lone surrogates, which a page must not put in the note. The Unicode
 * categories, because biome refuses a control character in a regex literal.
 */
const CONTROL = /[\p{Cc}\p{Cs}]/gu;

/** Line breaks that split a passage into paragraphs. U+2028 and U+2029 stay in, as spaces. */
const BREAK = /[\r\n]+/;

/**
 * Characters that open markdown, wikilink or html syntax. A hash is not here: `\#x` is a tag to
 * kasten, so `escapeParagraph` writes it as `&#35;`.
 */
const SPECIAL = /[\\`[\]<>!|~$%^]/g;

/** Characters an alias cannot hold: the wikilink's own, and markdown or `%%` openers. */
const ALIAS_BAD = /[[\]|#^\\<>!`$~*_%=]/g;

/** `text` cut to `cap` characters at most, the ellipsis counted among them. */
function capped(text: string, cap: number): string {
  // Counted in code points, so a cut never leaves a lone surrogate, which the backend refuses.
  const chars = Array.from(text);
  if (chars.length <= cap) return text;
  const kept = chars.slice(0, cap - 1).join("");
  return `${kept.trimEnd()}…`;
}

/**
 * One paragraph with its markup escaped. The first character is checked after the backslashes
 * are in, so a list marker or setext underline the escapes moved is still caught.
 */
function escapeParagraph(paragraph: string): string {
  return paragraph
    .replace(SPECIAL, "\\$&")
    .replace(/#/g, "&#35;")
    .replace(/^[-+*=]/, "\\$&")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

/**
 * `escapeParagraph` read back, in one pass from the left so a `\\` is never read twice. A lone
 * backslash before an unescaped character (from a note written before escapes) stays as it is.
 */
export function unescapeParagraph(paragraph: string): string {
  return paragraph.replace(
    /\\([\\`[\]<>!|~$%^\-+*=.)])|&#35;/g,
    (_, escaped?: string) => escaped ?? "#",
  );
}

/**
 * The text as its non-empty, collapsed paragraphs, control characters gone. Tabs become spaces
 * first, since Chrome puts one between a table's cells and removing it would join two words.
 */
function paragraphsOf(text: string): string[] {
  return text
    .replace(/\t/g, " ")
    .split(BREAK)
    .map((line) => collapse(line.replace(CONTROL, "")))
    .filter((paragraph) => paragraph !== "");
}

/**
 * The passage as escaped paragraphs, uncapped. The book's note keeps a passage whole, since a
 * quote cut short is never found in the book again.
 */
export function escapedParagraphs(text: string): string[] {
  return paragraphsOf(text).map(escapeParagraph);
}

/**
 * The passage as escaped, capped paragraphs. The cap counts what a reader sees, not the
 * backslashes added to it.
 */
export function quoteParagraphs(text: string): string[] {
  const paragraphs = paragraphsOf(text);

  // Each paragraph is a line of the note, so the count is capped too.
  // The last one kept says it was cut short.
  const truncated = paragraphs.length > PARAGRAPH_CAP;
  const shown = paragraphs
    .slice(0, PARAGRAPH_CAP)
    .map((paragraph, index, all) =>
      truncated && index === all.length - 1 ? `${paragraph}…` : paragraph,
    );

  const kept: string[] = [];
  let room = PASSAGE_CAP;
  for (const paragraph of shown) {
    if (room <= 0) break;
    const cut = capped(paragraph, room);
    kept.push(escapeParagraph(cut));
    room -= Array.from(cut).length;
  }
  return kept;
}

/**
 * A heading or file name as a link alias: no control characters or wikilink syntax, capped. The
 * one escape for any text a link carries, so a file name cannot close a link either.
 */
export function aliasOf(heading: string): string {
  const clean = collapse(heading.replace(CONTROL, "").replace(ALIAS_BAD, ""));
  return capped(clean, HEADING_CAP);
}

/** The file's own name, which is what a passage with no heading says it came from. */
export function fileOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Whether a path holds a character a wikilink cannot carry, so it needs a markdown link. */
export function needsMarkdown(path: string): boolean {
  return /[[\]|#]/.test(path);
}

/**
 * The posix path from the folder of `from` to `to`: shared folders are dropped, and each one left
 * in `from` becomes a `..`.
 */
export function relativePath(from: string, to: string): string {
  const folders = from.split("/").slice(0, -1);
  const parts = to.split("/");
  let shared = 0;
  while (
    shared < folders.length &&
    shared < parts.length - 1 &&
    folders[shared] === parts[shared]
  ) {
    shared += 1;
  }
  const climb = folders.slice(shared).map(() => "..");
  return [...climb, ...parts.slice(shared)].join("/");
}

/**
 * `[[<path>#<fragment>|<alias>]]`, or a markdown link when the path needs one. `fragment` has no
 * `#`, and "" means none. `alias` comes from `aliasOf`. A path with a bracket, bar or hash gets a
 * markdown link, its address encoded and relative to `from`, as Obsidian writes it.
 */
export function fileLink(path: string, fragment: string, alias: string, from: string): string {
  const hash = fragment === "" ? "" : `#${fragment}`;
  if (!needsMarkdown(path)) return `[[${path}${hash}|${alias}]]`;
  return `[${alias}](${encodeLinkPath(relativePath(from, path))}${hash})`;
}

/**
 * A vault path as a markdown address: each segment percent-encoded, slashes kept. `(` and `)`
 * must be encoded too, or they end the link early.
 */
export function encodeLinkPath(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/**
 * `[[<path>#<anchor>|<heading>]]`, the link back to a passage's place on the page. The anchor
 * keeps only the characters an id is made of.
 */
export function pageLink(path: string, passage: PagePassage, from: string): string {
  const anchor = passage.anchor.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, ANCHOR_CAP);
  const name = needsMarkdown(path) ? aliasOf(fileOf(path)) : fileOf(path);
  const alias = aliasOf(passage.heading) || name;
  return fileLink(path, anchor, alias, from);
}

/**
 * A passage as a blockquote, then the link to it as the last quoted line. A lone `>` separates
 * paragraphs, since a blank line would end the quote.
 */
export function quoteBlock(text: string, link: string): string {
  const quoted = quoteParagraphs(text)
    .map((paragraph) => `> ${paragraph}`)
    .join("\n>\n");
  const quotedLink = `> ${link}`;
  return quoted === "" ? quotedLink : `${quoted}\n>\n${quotedLink}`;
}

/** The dump paragraph for an HTML page's passage, linked to its place on the page. */
export function takenQuote(path: string, passage: PagePassage, from: string): string {
  return quoteBlock(passage.text, pageLink(path, passage, from));
}

/**
 * `note` with the `quote` block taken out of its `## Dump` section, or null when the block is not
 * in that section exactly once. A block edited by hand is left where it is.
 */
export function withoutTaken(note: string, quote: string): string | null {
  const section = noteSectionOf(note, "Dump");
  if (section === null) return null;

  const lines = note.split("\n");
  const at = section.line - 1;
  if (lines[at]?.trimEnd() !== "## Dump") return null;

  const dump = lines.slice(at, at + section.text.split("\n").length);
  const block = quote.split("\n");
  const hits: number[] = [];
  for (let index = 0; index + block.length <= dump.length; index += 1) {
    if (block.every((line, offset) => dump[index + offset] === line)) hits.push(index);
  }
  const [hit] = hits;
  if (hits.length !== 1 || hit === undefined) return null;

  const first = at + hit;
  // The blank line the writer put in front of the capture goes with it, and
  // a dump that held nothing before the capture has none to take.
  const cut = lines[first - 1] === "" ? first - 1 : first;
  return [...lines.slice(0, cut), ...lines.slice(first + block.length)].join("\n");
}
