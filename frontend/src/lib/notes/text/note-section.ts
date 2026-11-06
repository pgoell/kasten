/**
 * A heading's section in a note: found, and appended to. Pure, and ignorant of the line appended,
 * since where a section ends has nothing to do with what the line is.
 */

import { noteBody } from "@/lib/notes/text/note-frontmatter";

/** Any heading outside a fence, which is what ends the section above it. */
const HEADING = /^#{1,6} /;

/** An ATX heading's level and its title. */
const TITLED = /^(#{1,6})[ \t]+(.*)$/;

/** The backtick or tilde run that opens or closes a fence, and what follows it. */
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)/;

/** A closing run alone on its line, its indent measured apart from the margin. */
const CLOSER = /^(`{3,}|~{3,})$/;

/** A list marker and the space after it, where the item's content starts. */
const LIST_MARKER = /^([ \t]*)([-*+]|\d{1,9}[.)])( +|$)/;

/**
 * One read's state: each line's item column worked out so far, so a deep marker is walked once,
 * and the fenced lines above the line being read.
 */
interface Known {
  columns: Map<number, number>;
  coded: Set<number>;
  text: Map<number, boolean>;
  left: number[];
}

/** An ATX heading's hashes, wherever the line is indented. */
const HEADING_LINE = /^#{1,6}( |$)/;

/** A thematic break, after which no line is lazy. */
const BREAK = /^([-*_])( *\1){2,}[ \t]*$/;

/** A quote or thematic break, unindented: it ends a list item when it sits left of the item's content. */
function quoteOrBreak(line: string): boolean {
  return line.startsWith(">") || BREAK.test(line);
}

/**
 * The column a list item's content starts at. Five or more spaces after the marker is indented
 * code, so the content starts one space on, as it does for an empty marker.
 */
function contentColumn(marker: RegExpExecArray): number {
  const [, lead = "", bullet = "", gap = ""] = marker;
  const extra = gap.length === 0 || gap.length >= 5 ? 1 : gap.length;
  return width(lead) + bullet.length + extra;
}

/** How far a line is indented in columns, a tab running to the next multiple of four. */
function width(line: string): number {
  let column = 0;
  for (const char of line) {
    if (char === " ") column += 1;
    else if (char === "\t") column += 4 - (column % 4);
    else break;
  }
  return column;
}

/** A bare run as long as `open`, of its character, indented at most three past `column` (#1480). */
function closes(line: string, open: string, column: number): boolean {
  const run = CLOSER.exec(line.trim())?.[1];
  return (
    run !== undefined &&
    run[0] === open[0] &&
    run.length >= open.length &&
    width(line) <= column + 3
  );
}

/**
 * The run that opens a fence on line `index`, or undefined. It sits at most three past the margin
 * or past the content column of its list item, nested ones too (#1550).
 */
function openingRun(lines: string[], index: number, known: Known): string | undefined {
  const line = lines[index] ?? "";
  const match = FENCE.exec(line);
  const fence = match?.[1];
  if (fence === undefined || (fence[0] === "`" && match?.[2]?.includes("`"))) return undefined;
  return width(line) <= itemColumn(lines, index, known) + 3 ? fence : undefined;
}

/**
 * The indices of fenced code lines, fences included, and the run of a fence nobody closes. A
 * `# comment` in a shell block is code, not a heading. A fence closes on a run at least as long,
 * and a fence in a list item ends with the item, at a line indented less than its content.
 */
export function fencedLines(lines: string[]): {
  coded: Set<number>;
  openFrom: number | null;
  openRun: string | null;
  openColumn: number;
} {
  const coded = new Set<number>();
  let open: string | null = null;
  let openFrom: number | null = null;
  let column = 0;
  const known: Known = { columns: new Map(), coded, text: new Map(), left: leftOf(lines) };
  lines.forEach((line, index) => {
    if (open !== null && line.trim() !== "" && width(line) < column) {
      open = null;
      openFrom = null;
    }
    const fence = open === null ? openingRun(lines, index, known) : undefined;
    if (fence !== undefined) {
      open = fence;
      openFrom = index;
      column = itemColumn(lines, index, known);
      coded.add(index);
    } else if (open !== null) {
      known.columns.set(index, column);
      if (closes(line, open, column)) {
        open = null;
        openFrom = null;
      }
      coded.add(index);
    }
  });
  return { coded, openFrom, openRun: open, openColumn: column };
}

/**
 * The section `heading` opens in `text`, and the 1-based line it opens on, or null. The section
 * runs to the next heading of its level or higher. Titles match ignoring case and outer spaces.
 */
export function sectionOf(text: string, heading: string): { text: string; line: number } | null {
  const lines = text.split("\n");
  const wanted = heading.trim().toLowerCase();

  const { coded } = fencedLines(lines);

  const titleAt = (index: number) => (coded.has(index) ? null : TITLED.exec(lines[index] ?? ""));
  const levelAt = (index: number) => titleAt(index)?.[1]?.length ?? 0;

  const at = lines.findIndex((_, index) => titleAt(index)?.[2]?.trim().toLowerCase() === wanted);
  if (at === -1) return null;

  const level = levelAt(at);
  let end = at + 1;
  while (end < lines.length && !(levelAt(end) > 0 && levelAt(end) <= level)) end += 1;
  return { text: lines.slice(at, end).join("\n"), line: at + 1 };
}

/**
 * `sectionOf` on a whole note file. The heading is searched in the body, since a YAML comment reads
 * as a heading to anything counting hashes. The line is counted from the top of the file.
 */
export function noteSectionOf(
  text: string,
  heading: string,
): { text: string; line: number } | null {
  const body = noteBody(text);
  const section = sectionOf(body, heading);
  if (section === null) return null;
  const above = text.split("\n").length - body.split("\n").length;
  return { text: section.text, line: section.line + above };
}

/** One edit as a range in the old text and what replaces it. */
export interface Edit {
  from: number;
  to: number;
  insert: string;
}

/** The line a section ends on: the next heading outside a fence, or the end of the note. */
function sectionEnd(lines: string[], at: number, isFenced: (index: number) => boolean): number {
  let end = at + 1;
  while (end < lines.length && !(HEADING.test(lines[end] ?? "") && !isFenced(end))) end += 1;
  return end;
}

/**
 * The content column of the list item line `index` sits in, or 0 outside one. A closer at column 0
 * would fall out of the item.
 */
function itemColumn(lines: string[], index: number, known: Known): number {
  const held = known.columns.get(index);
  if (held !== undefined) return held;
  const column = walkItemColumn(lines, index, known);
  known.columns.set(index, column);
  return column;
}

function walkItemColumn(lines: string[], line: number, known: Known): number {
  const n = width(lines[line] ?? "");
  if (n === 0) return 0;
  const index = known.left[line] ?? -1;
  if (index < 0) return 0;
  if (heading(lines, index, known)) return itemColumn(lines, index, known);
  const first = markerAt(lines, index, known);
  // A deeper item has ended at this line, which sits in the item its marker sits in.
  if (first !== null) {
    return contentColumn(first) <= n ? contentColumn(first) : itemColumn(lines, index, known);
  }
  return lazyItemColumn(lines, index, n, known);
}

/**
 * For each line, the nearest non-blank line above it that is indented less, or -1. One pass, so a
 * long run of deep lines is not walked once per line (#1583).
 */
function leftOf(lines: string[]): number[] {
  const stack: number[] = [];
  return lines.map((line, index) => {
    if (line.trim() === "") return stack.at(-1) ?? -1;
    const n = width(line);
    while (stack.length > 0 && width(lines[stack.at(-1) ?? 0] ?? "") >= n) stack.pop();
    const left = stack.at(-1) ?? -1;
    stack.push(index);
    return left;
  });
}

/**
 * The list marker line `index` opens an item with, or null. A break is no marker (#1557), and one
 * four or more columns in is an item only within three of its own item's content (#1553).
 */
function markerAt(lines: string[], index: number, known: Known): RegExpExecArray | null {
  const line = lines[index] ?? "";
  if (quoteOrBreak(line.trimStart())) return null;
  const marker = LIST_MARKER.exec(line);
  if (marker === null || width(line) <= 3) return marker;
  return width(line) <= itemColumn(lines, index, known) + 3 ? marker : null;
}

/**
 * A lazy continuation line's item: its marker may sit further up, with no blank line between. A
 * quote or break left of the item's content ends the item.
 */
function lazyItemColumn(lines: string[], from: number, n: number, known: Known): number {
  let edge = n;
  for (let index = from; index >= 0; index -= 1) {
    const held = lines[index] ?? "";
    if (quoteOrBreak(held.trimStart())) edge = Math.min(edge, width(held));
    const marker = index === from ? null : markerAt(lines, index, known);
    // An item whose content sits past the edge has ended: go on up to one that holds it (#1557).
    if (marker !== null && contentColumn(marker) <= Math.min(n, edge)) return contentColumn(marker);
    // An outer item holds a passed marker only at or left of its lead.
    if (marker !== null) edge = Math.min(edge, width(held));
    const placed = placedColumn(lines, index, Math.min(n, edge), known);
    if (placed !== null) return placed;
  }
  return 0;
}

/**
 * A fence line, or a line after one or a break, is no lazy line: its indent places it, in an item
 * at most `cap` (#1581). A blank line or a heading ends every item. Null for a line that may be lazy.
 */
function placedColumn(lines: string[], index: number, cap: number, known: Known): number | null {
  const held = lines[index] ?? "";
  if (held.trim() === "") return 0;
  const lazy =
    !known.coded.has(index) &&
    !heading(lines, index, known) &&
    !fenceEnds(lines, index, known) &&
    paragraph(lines, index - 1, known);
  if (lazy) return null;
  const column = itemColumn(lines, index, known);
  return column <= cap ? column : 0;
}

/**
 * Whether line `index` is paragraph text, which the line below may continue lazily. Filled upward
 * from the nearest line already read, so a long run costs no deep recursion.
 */
function paragraph(lines: string[], index: number, known: Known): boolean {
  let from = index;
  while (from >= 0 && !known.text.has(from)) from -= 1;
  for (let at = from + 1; at <= index; at += 1) known.text.set(at, isText(lines, at, known));
  return known.text.get(index) ?? false;
}

/**
 * Paragraph text, given the lines above. A line four past its item's content after anything else
 * is indented code (#1583).
 */
function isText(lines: string[], index: number, known: Known): boolean {
  const held = lines[index] ?? "";
  if (held.trim() === "" || known.coded.has(index) || BREAK.test(held.trim())) return false;
  if (heading(lines, index, known) || fenceEnds(lines, index, known)) return false;
  return width(held) < itemColumn(lines, index, known) + 4 || paragraph(lines, index - 1, known);
}

/**
 * Whether line `index` is a heading. Under paragraph text its hashes sit at most three past the
 * paragraph's content, else at most three past its own item's (#1583).
 */
function heading(lines: string[], index: number, known: Known): boolean {
  const held = lines[index] ?? "";
  if (!HEADING_LINE.test(held.trimStart())) return false;
  const above = paragraph(lines, index - 1, known);
  const marker = above ? markerAt(lines, index - 1, known) : null;
  const column =
    marker !== null ? contentColumn(marker) : itemColumn(lines, above ? index - 1 : index, known);
  return width(held) <= column + 3;
}

/**
 * Whether line `index` is a fence run that ends the paragraph above it, as a heading does: its indent
 * sits at most three past the content column, not further in as indented code (#1585).
 */
function fenceEnds(lines: string[], index: number, known: Known): boolean {
  const held = lines[index] ?? "";
  const match = FENCE.exec(held);
  const fence = match?.[1];
  if (fence === undefined || (fence[0] === "`" && match?.[2]?.includes("`"))) return false;
  const above = paragraph(lines, index - 1, known);
  const marker = above ? markerAt(lines, index - 1, known) : null;
  const column =
    marker !== null ? contentColumn(marker) : itemColumn(lines, above ? index - 1 : index, known);
  return width(held) <= column + 3;
}

/**
 * How many lines the frontmatter takes, and the fenced lines of the body counted from the top of the note.
 * Fences are found in the body alone, so a fence the frontmatter seems to open hides nothing.
 */
export function bodyFences(lines: string[]): { above: number; coded: Set<number> } {
  const above = lines.length - noteBody(lines.join("\n")).split("\n").length;
  const coded = new Set([...fencedLines(lines.slice(above)).coded].map((at) => at + above));
  return { above, coded };
}

/**
 * The edit that puts `line` under `heading`. Offsets, not text, because one CodeMirror change over
 * the range keeps the undo history and the cursor whole. `appendUnder` is this applied.
 */
export function appendUnderEdit(text: string, heading: string, line: string): Edit {
  const lines = text.split("\n");
  // Match the readers: trailing spaces are allowed, and a fence or frontmatter line never counts.
  const above = lines.length - noteBody(text).split("\n").length;
  const { coded: fenced, openFrom, openRun, openColumn } = fencedLines(lines.slice(above));
  const isFenced = (index: number) => fenced.has(index - above);
  const at = lines.findIndex(
    (held, index) => index >= above && !isFenced(index) && held.trimEnd() === heading,
  );

  // The readers count nothing past an unclosed fence, so close it first when the line lands inside.
  if (
    openFrom !== null &&
    openRun !== null &&
    (at === -1 || sectionEnd(lines, at, isFenced) === lines.length) &&
    openColumn === 0
  ) {
    const closed = text.endsWith("\n") ? `${text}${openRun}\n` : `${text}\n${openRun}`;
    const edit = appendUnderEdit(closed, heading, line);
    // One change against `text`, so one undo takes the closer and the line back together.
    return {
      from: text.length,
      to: text.length,
      insert: closed.slice(text.length, edit.from) + edit.insert + closed.slice(edit.to),
    };
  }

  if (at === -1) {
    // No section: make one at the end, after a blank line.
    const trimmed = text.replace(/\n+$/, "");
    return { from: trimmed.length, to: text.length, insert: `\n\n${heading}\n${line}\n` };
  }

  let end = sectionEnd(lines, at, isFenced);
  while (end > at + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;

  // Nothing follows the section, so the line goes on the end with its newline in front.
  if (end === lines.length) return { from: text.length, to: text.length, insert: `\n${line}` };

  let offset = 0;
  for (let index = 0; index < end; index += 1) offset += (lines[index] ?? "").length + 1;
  return { from: offset, to: offset, insert: `${line}\n` };
}

/**
 * Put `line` at the end of `heading`'s section, making the section if there is none. The blank line
 * before the next heading stays put, or the line would read as part of the heading below.
 */
export function appendUnder(text: string, heading: string, line: string): string {
  const { from, to, insert } = appendUnderEdit(text, heading, line);
  return text.slice(0, from) + insert + text.slice(to);
}
