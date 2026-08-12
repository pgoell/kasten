/**
 * A heading's section in a note: found, and appended to.
 *
 * Pure, and deliberately ignorant of what the line it is handed means. A todo's
 * done log, a time log and a highlight all end up at the end of a section, and
 * the rule for where that end is has nothing to do with any of the three.
 */

/** Any heading, which is what ends the section above it. */
const HEADING = /^#{1,6} /;

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
