/**
 * A heading's section in a note: found, and appended to.
 *
 * Pure, and deliberately ignorant of what the line it is handed means. A todo's
 * done log, a time log and a highlight all end up at the end of a section, and
 * the rule for where that end is has nothing to do with any of the three.
 */

import { noteBody } from "@/lib/note-frontmatter";

/** Any heading outside a fence, which is what ends the section above it. */
const HEADING = /^#{1,6} /;

/** An ATX heading's level and its title. */
const TITLED = /^(#{1,6})[ \t]+(.*)$/;

/** The run of backticks or tildes that opens or closes a fenced code block, and what follows it. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)/;

/** A list marker and the space after it, where the item's content starts. */
const LIST_MARKER = /^( {0,3})([-*+]|\d{1,9}[.)])( +)/;

/**
 * The indices of the lines that are fenced code, fences included, the index of
 * the fence's opening line where a fence nobody closes runs to the end, and the
 * run that opened that fence.
 *
 * A `# comment` in a shell block is code, not a heading: it neither opens a
 * section nor ends one. A fence closes on a run of its own character at least as
 * long as the one that opened it, which is CommonMark's rule. A backtick fence's
 * info string holds no backtick, so a line of inline ```x``` opens nothing.
 */
function fencedLines(lines: string[]): {
  coded: Set<number>;
  openFrom: number | null;
  openRun: string | null;
} {
  const coded = new Set<number>();
  let open: string | null = null;
  let openFrom: number | null = null;
  lines.forEach((line, index) => {
    const match = FENCE.exec(line);
    const fence = match?.[1];
    const opens = fence !== undefined && (fence[0] === "~" || !match?.[2]?.includes("`"));
    if (open === null && fence !== undefined && opens) {
      open = fence;
      openFrom = index;
      coded.add(index);
    } else if (open !== null) {
      const closes =
        fence !== undefined &&
        fence[0] === open[0] &&
        fence.length >= open.length &&
        line.trim() === fence;
      if (closes) {
        open = null;
        openFrom = null;
      }
      coded.add(index);
    }
  });
  return { coded, openFrom, openRun: open };
}

/**
 * The section `heading` opens in `text`, and the 1-based line it opens on.
 *
 * What `![[note#heading]]` draws: the heading and everything under it up to the
 * next heading of its own level or higher, a lower one being part of it. The
 * title is matched ignoring case and the space around it, because a link is
 * typed from memory and Obsidian forgives both. Null where no heading matches.
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
 * `sectionOf` read off a whole note file rather than its body.
 *
 * The heading is looked for in the body, because a YAML comment reads as a
 * heading to anything that only counts hashes. The line is counted in the
 * whole file, frontmatter and all, since that is the file the editor opens.
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
 * Whether the fence opened on line `opener` sits in a list item: the first text
 * line above it indented less than the fence is a list marker whose content the
 * fence lines up under. A closer at column 0 would fall out of that item, so such
 * a fence is left as it is. Lines above `floor`, the frontmatter, are not read.
 */
function inListItem(lines: string[], floor: number, opener: number): boolean {
  const indent = (line: string) => line.length - line.trimStart().length;
  const n = indent(lines[opener] ?? "");
  if (n === 0) return false;
  for (let index = opener - 1; index >= floor; index -= 1) {
    const held = lines[index] ?? "";
    if (held.trim() === "" || indent(held) >= n) continue;
    const marker = LIST_MARKER.exec(held);
    return marker !== null && (marker[0] ?? "").length <= n;
  }
  return false;
}

/**
 * The edit that puts `line` under `heading`, rather than the text it produces.
 *
 * Offsets because the editor needs them: a todo in today's own note logs itself
 * into the buffer being typed into, and one CodeMirror change over a range is
 * what keeps the undo history and the cursor whole. `appendUnder` is this
 * applied.
 */
export function appendUnderEdit(text: string, heading: string, line: string): Edit {
  const lines = text.split("\n");
  // The readers take a heading with trailing spaces or tabs, and never one in a
  // fence or the frontmatter, so the writer finds the same one they do.
  const above = lines.length - noteBody(text).split("\n").length;
  const { coded: fenced, openFrom, openRun } = fencedLines(lines.slice(above));
  const isFenced = (index: number) => fenced.has(index - above);
  const at = lines.findIndex(
    (held, index) => index >= above && !isFenced(index) && held.trimEnd() === heading,
  );

  // The readers count nothing past a fence nobody closes, so a line written there
  // lands where they never look. Close the fence first when the line would land
  // inside it: the body ends in it, and the section the line goes in runs to the
  // end of the note too (or there is no section, so one is made at the end).
  if (
    openFrom !== null &&
    openRun !== null &&
    (at === -1 || sectionEnd(lines, at, isFenced) === lines.length) &&
    !inListItem(lines, above, above + openFrom)
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
    // No section, so it is made at the end, off a blank line from whatever the
    // note already ends with.
    const trimmed = text.replace(/\n+$/, "");
    return { from: trimmed.length, to: text.length, insert: `\n\n${heading}\n${line}\n` };
  }

  let end = sectionEnd(lines, at, isFenced);
  while (end > at + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;

  // Nothing follows the section, so the line goes on the end with a newline in
  // front of it rather than behind.
  if (end === lines.length) return { from: text.length, to: text.length, insert: `\n${line}` };

  let offset = 0;
  for (let index = 0; index < end; index += 1) offset += (lines[index] ?? "").length + 1;
  return { from: offset, to: offset, insert: `${line}\n` };
}

/**
 * Put `line` at the end of `heading`'s section, making the section where there
 * is none.
 *
 * The blank line before the next heading stays where it is: a section is read
 * by eye as much as by this, and a log line pushed under the gap would read as
 * belonging to the heading below.
 */
export function appendUnder(text: string, heading: string, line: string): string {
  const { from, to, insert } = appendUnderEdit(text, heading, line);
  return text.slice(0, from) + insert + text.slice(to);
}
