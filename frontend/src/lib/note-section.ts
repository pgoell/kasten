/**
 * A heading's section in a note: found, and appended to.
 *
 * Pure, and deliberately ignorant of what the line it is handed means. A todo's
 * done log, a time log and a highlight all end up at the end of a section, and
 * the rule for where that end is has nothing to do with any of the three.
 */

/** Any heading, which is what ends the section above it. */
const HEADING = /^#{1,6} /;

/** An ATX heading's level and its title. */
const TITLED = /^(#{1,6})[ \t]+(.*)$/;

/** The run of backticks or tildes that opens or closes a fenced code block. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

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

  // A `# comment` in a shell block is code, not a heading: it neither opens a
  // section nor ends one. A fence closes on a run of its own character at
  // least as long as the one that opened it, which is CommonMark's rule.
  const coded = new Set<number>();
  let open: string | null = null;
  lines.forEach((line, index) => {
    const fence = FENCE.exec(line)?.[1];
    if (open === null && fence !== undefined) open = fence;
    else if (open !== null) {
      const closes =
        fence !== undefined &&
        fence[0] === open[0] &&
        fence.length >= open.length &&
        line.trim() === fence;
      if (closes) {
        open = null;
      }
      coded.add(index);
    }
  });

  const titleAt = (index: number) => (coded.has(index) ? null : TITLED.exec(lines[index] ?? ""));
  const levelAt = (index: number) => titleAt(index)?.[1]?.length ?? 0;

  const at = lines.findIndex((_, index) => titleAt(index)?.[2]?.trim().toLowerCase() === wanted);
  if (at === -1) return null;

  const level = levelAt(at);
  let end = at + 1;
  while (end < lines.length && !(levelAt(end) > 0 && levelAt(end) <= level)) end += 1;
  return { text: lines.slice(at, end).join("\n"), line: at + 1 };
}

/** One edit as a range in the old text and what replaces it. */
export interface Edit {
  from: number;
  to: number;
  insert: string;
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
  const at = lines.indexOf(heading);

  if (at === -1) {
    // No section, so it is made at the end, off a blank line from whatever the
    // note already ends with.
    const trimmed = text.replace(/\n+$/, "");
    return { from: trimmed.length, to: text.length, insert: `\n\n${heading}\n${line}\n` };
  }

  let end = at + 1;
  while (end < lines.length && !HEADING.test(lines[end] ?? "")) end += 1;
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
