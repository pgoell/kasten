/**
 * A passage a vault HTML page hands over, written into today's `## Dump`.
 *
 * The page is not trusted, so its text and heading can hold anything. Every
 * character that could open a link, a fence, a heading or a list is escaped
 * here, and every line of the quote starts with `> `, so no line the page
 * sends can stand as a heading, a `## Dump`, a rule or a todo. Pure: the write
 * goes through the dump path, and this only says what to write.
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
 * Control characters, removed so a page cannot put a NUL or a bell in the note.
 *
 * The Unicode categories rather than a range of code points, since biome refuses
 * a control character written into a regex. The control category also takes the
 * C1 block, which a page has no business sending either. The surrogate category
 * takes a lone half of a pair, which the backend's text reader refuses.
 */
const CONTROL = /[\p{Cc}\p{Cs}]/gu;

/**
 * Line breaks, which split a passage into paragraphs.
 *
 * The Unicode line and paragraph separators are not split on: `collapse` reads
 * them as spaces, so they join a paragraph rather than start one.
 */
const BREAK = /[\r\n]+/;

/**
 * Characters that open markdown, wikilink or html syntax, each escaped with a backslash.
 *
 * The hash is not here: kasten's tag reader takes `\#x` for the tag `#x`, so a
 * hash becomes the entity `&#35;` instead (see `escapeParagraph`).
 */
const SPECIAL = /[\\`[\]<>!|~$%^]/g;

/**
 * Characters the alias cannot hold: the wikilink's own, and the ones that open an
 * html comment, code, math, emphasis or a `%%` comment in the reader's view.
 */
const ALIAS_BAD = /[[\]|#^\\<>!`$~*_%=]/g;

/** `text` cut to `cap` characters at most, the ellipsis counted among them. */
function capped(text: string, cap: number): string {
  // Counted in code points, since a cut through a surrogate pair leaves a lone
  // half that the backend's text reader refuses.
  const chars = Array.from(text);
  if (chars.length <= cap) return text;
  const kept = chars.slice(0, cap - 1).join("");
  return `${kept.trimEnd()}…`;
}

/**
 * One paragraph with its markup characters escaped.
 *
 * The first character is checked after the backslashes are in, so a list
 * marker or a setext underline is caught even where the escapes moved it. A
 * digit list is escaped at its dot or paren, which is what `1.` needs to stop
 * being an ordered list item.
 */
function escapeParagraph(paragraph: string): string {
  return paragraph
    .replace(SPECIAL, "\\$&")
    .replace(/#/g, "&#35;")
    .replace(/^[-+*=]/, "\\$&")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

/**
 * The passage as escaped, collapsed, capped paragraphs, one line each, no `> `.
 *
 * The cap is taken before the escapes, so it counts the characters the reader
 * sees rather than the backslashes added to them.
 */
export function quoteParagraphs(text: string): string[] {
  const paragraphs = text
    .split(BREAK)
    .map((line) => collapse(line.replace(CONTROL, "")))
    .filter((paragraph) => paragraph !== "");

  // A page can send thousands of lines, and each becomes a line of the note, so
  // the paragraph count is capped as well as the characters. The last one kept
  // says it was cut short.
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
 * The heading, or a file name, as an alias: no control characters, no wikilink
 * syntax, capped. The one escape for any text a link carries, so a file name
 * cannot close a link any more than a heading can.
 */
export function aliasOf(heading: string): string {
  const clean = collapse(heading.replace(CONTROL, "").replace(ALIAS_BAD, ""));
  return capped(clean, HEADING_CAP);
}

/** The file's own name, which is what a passage with no heading says it came from. */
export function fileOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * `[[<path>#<fragment>|<alias>]]`, or `[<alias>](<address>#<fragment>)` when the
 * path holds a character a wikilink cannot carry. `fragment` is given without its
 * `#`, and "" means none.
 *
 * A wikilink cannot hold a bracket in its name and has no escape for a bar or a
 * hash, so such a path is linked the way Obsidian links it: a markdown link whose
 * address is percent-encoded. The alias is the link's text, so it goes through
 * `aliasOf` as well, or a bracket in a file name would close the text.
 */
export function fileLink(path: string, fragment: string, alias: string): string {
  const hash = fragment === "" ? "" : `#${fragment}`;
  if (!/[[\]|#]/.test(path)) return `[[${path}${hash}|${alias}]]`;
  return `[${aliasOf(alias)}](${encodeLinkPath(path)}${hash})`;
}

/**
 * A vault path as a markdown link's address: each segment percent-encoded, the
 * slashes kept. `encodeURIComponent` leaves `!'()*` alone, and a `(` or a `)` in
 * an address ends the link early, so those are encoded by hand.
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
 * `[[<path>#<anchor>|<heading>]]`, the link back to the passage's place on the page.
 *
 * The path is Kasten's own and taken as it is. The anchor is what the page
 * sends, so only the characters an id is made of survive.
 */
export function pageLink(path: string, passage: PagePassage): string {
  const anchor = passage.anchor.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, ANCHOR_CAP);
  const alias = aliasOf(passage.heading) || fileOf(path);
  return fileLink(path, anchor, alias);
}

/**
 * The dump paragraph for a passage and the link it is quoted from: the passage
 * as a blockquote, then the link to it.
 *
 * A lone `>` between paragraphs and not a blank line, since a blank line ends
 * the blockquote. The link is the last paragraph, under the same quote. Shared
 * by the HTML and the PDF takes, so the escape of a page's text is one function.
 */
export function quoteBlock(text: string, link: string): string {
  const quoted = quoteParagraphs(text)
    .map((paragraph) => `> ${paragraph}`)
    .join("\n>\n");
  const quotedLink = `> ${link}`;
  return quoted === "" ? quotedLink : `${quoted}\n>\n${quotedLink}`;
}

/** The dump paragraph for an HTML page's passage, linked to its place on the page. */
export function takenQuote(path: string, passage: PagePassage): string {
  return quoteBlock(passage.text, pageLink(path, passage));
}

/**
 * `note` with the `quote` block taken out of its `## Dump` section, or null
 * when the block is not in that section exactly once.
 *
 * The section is found by `noteSectionOf`, which reads a heading of any level
 * with that title, so the `## Dump` check on its first line keeps this to the
 * heading the dump writer uses. A block edited by hand, or moved out of the
 * dump, is no longer the block and is left where it is.
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
