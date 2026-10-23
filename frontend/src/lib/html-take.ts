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

/** Characters of anchor kept. */
const ANCHOR_CAP = 100;

/**
 * Control characters, removed so a page cannot put a NUL or a bell in the note.
 *
 * The Unicode category rather than a range of code points, since biome refuses
 * a control character written into a regex. The category also takes the C1
 * block, which a page has no business sending either.
 */
const CONTROL = /\p{Cc}/gu;

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

/** Characters the alias cannot hold, since kasten's wikilink parser reads it up to `]]`. */
const ALIAS_BAD = /[[\]|#^\\]/g;

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

  const kept: string[] = [];
  let room = PASSAGE_CAP;
  for (const paragraph of paragraphs) {
    if (room <= 0) break;
    const cut = capped(paragraph, room);
    kept.push(escapeParagraph(cut));
    room -= Array.from(cut).length;
  }
  return kept;
}

/** The heading as an alias: no control characters, no wikilink syntax, capped. */
function aliasOf(heading: string): string {
  const clean = collapse(heading.replace(CONTROL, "").replace(ALIAS_BAD, ""));
  return capped(clean, HEADING_CAP);
}

/**
 * `[[<path>#<anchor>|<heading>]]`, the link back to the passage's place on the page.
 *
 * The path is Kasten's own and taken as it is. The anchor is what the page
 * sends, so only the characters an id is made of survive.
 */
export function pageLink(path: string, passage: PagePassage): string {
  const anchor = passage.anchor.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, ANCHOR_CAP);
  const alias = aliasOf(passage.heading) || path.slice(path.lastIndexOf("/") + 1);
  return `[[${path}${anchor === "" ? "" : `#${anchor}`}|${alias}]]`;
}

/**
 * The dump paragraph: the passage as a blockquote, then the link to it.
 *
 * A lone `>` between paragraphs and not a blank line, since a blank line ends
 * the blockquote. The link is the last paragraph, under the same quote.
 */
export function takenQuote(path: string, passage: PagePassage): string {
  const quoted = quoteParagraphs(passage.text)
    .map((paragraph) => `> ${paragraph}`)
    .join("\n>\n");
  const link = `> ${pageLink(path, passage)}`;
  return quoted === "" ? link : `${quoted}\n>\n${link}`;
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
