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
const LIST_MARKER = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/;

/** An ATX heading line, which ends a list item's paragraph whatever is above it. */
const HEADING_LINE = /^#{1,6}( |$)/;

/**
 * The column a list item's content starts at. Five or more spaces after the marker is indented
 * code, so the content starts one space on, as it does for an empty marker.
 */
function contentColumn(marker: RegExpExecArray): number {
  const [, lead = "", bullet = "", gap = ""] = marker;
  const extra = gap.length === 0 || gap.length >= 5 ? 1 : gap.length;
  return lead.length + bullet.length + extra;
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
function openingRun(lines: string[], index: number): string | undefined {
  const line = lines[index] ?? "";
  const match = FENCE.exec(line);
  const fence = match?.[1];
  if (fence === undefined || (fence[0] === "`" && match?.[2]?.includes("`"))) return undefined;
  return width(line) <= itemColumn(lines, 0, index) + 3 ? fence : undefined;
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
} {
  const coded = new Set<number>();
  let open: string | null = null;
  let openFrom: number | null = null;
  let column = 0;
  lines.forEach((line, index) => {
    if (open !== null && line.trim() !== "" && width(line) < column) {
      open = null;
      openFrom = null;
    }
    const fence = open === null ? openingRun(lines, index) : undefined;
    if (fence !== undefined) {
      open = fence;
      openFrom = index;
      column = itemColumn(lines, 0, index);
      coded.add(index);
    } else if (open !== null) {
      if (closes(line, open, column)) {
        open = null;
        openFrom = null;
      }
      coded.add(index);
    }
  });
  return { coded, openFrom, openRun: open };
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
 * The content column of the list item the fence on line `opener` sits in, or 0 outside one. A
 * closer at column 0 would fall out of the item. Lines above `floor` (the frontmatter) are not read.
 */
function itemColumn(lines: string[], floor: number, opener: number): number {
  const n = width(lines[opener] ?? "");
  if (n === 0) return 0;
  const at = (index: number) => lines[index] ?? "";
  let index = opener - 1;
  while (index >= floor && (at(index).trim() === "" || width(at(index)) >= n)) index -= 1;
  if (index < floor || HEADING_LINE.test(at(index))) return 0;
  const first = LIST_MARKER.exec(at(index));
  if (first !== null) return contentColumn(first) <= n ? contentColumn(first) : 0;
  return lazyItemColumn(lines, floor, index - 1, n);
}

/** A lazy continuation line's item: its marker may sit further up, with no blank line between. */
function lazyItemColumn(lines: string[], floor: number, from: number, n: number): number {
  for (let index = from; index >= floor; index -= 1) {
    const held = lines[index] ?? "";
    if (held.trim() === "" || HEADING_LINE.test(held)) return 0;
    const marker = LIST_MARKER.exec(held);
    if (marker !== null && contentColumn(marker) <= n) return contentColumn(marker);
  }
  return 0;
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
  const { coded: fenced, openFrom, openRun } = fencedLines(lines.slice(above));
  const isFenced = (index: number) => fenced.has(index - above);
  const at = lines.findIndex(
    (held, index) => index >= above && !isFenced(index) && held.trimEnd() === heading,
  );

  // The readers count nothing past an unclosed fence, so close it first when the line lands inside.
  if (
    openFrom !== null &&
    openRun !== null &&
    (at === -1 || sectionEnd(lines, at, isFenced) === lines.length) &&
    itemColumn(lines, above, above + openFrom) === 0
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
