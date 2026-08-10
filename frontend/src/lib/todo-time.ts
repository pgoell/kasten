/**
 * A session line, which is one line of a `## Time` section read into a record
 * and written back out.
 *
 * The same bargain `todo.ts` strikes for a task line: the line is the whole
 * record, so a session is spelled where you can read it, correct it by typing
 * and see it in Obsidian. The log is what a worked total is summed from, and
 * `⏱` on the task line is kasten's summary of it rather than a second record.
 *
 * Durations live here too, because `⏲ 2h` and `⏱ 1h20m` are one spelling read
 * twice and the arithmetic on them belongs beside the log it comes from.
 */

export interface Session {
  /** `HH:MM`, the wall clock the session opened at. */
  start: string;
  /** `HH:MM`, absent while it runs. */
  end?: string;
  /** The todo's words, copied at the start so the log reads on its own. */
  text: string;
  /** The note the todo lives in, without `.md`. Absent when it is this note. */
  link?: string;
  /** The todo's id, which is what a stop finds the line by. */
  id?: string;
}

/** The bullet, both clocks, and everything after them. */
const LINE = /^[ \t]*- (\d{2}:\d{2})-(\d{2}:\d{2})?[ \t]*(.*)$/;

const LINK = /\[\[([^\]]+)\]\]/;

/**
 * How wide the two clocks are written, which is `09:12-10:32`.
 *
 * A running line is padded out to the same width so the words of an open and a
 * closed session sit at one column and a day's log reads down the page.
 */
const CLOCKS = 11;

export function parseSession(line: string): Session | null {
  const found = LINE.exec(line);
  if (found === null) return null;

  let rest = found[3] ?? "";

  const link = LINK.exec(rest);
  if (link !== null) rest = rest.slice(0, link.index) + rest.slice(link.index + link[0].length);

  const words = rest.split(/\s+/).filter((word) => word !== "");
  // Last rather than first: the id is written last, and a `kt-` in the words is
  // then something somebody typed about a todo rather than the name of one.
  let at = -1;
  for (const [index, word] of words.entries()) if (word.startsWith("kt-")) at = index;
  const id = at === -1 ? undefined : words[at];
  if (at !== -1) words.splice(at, 1);

  return {
    start: found[1] ?? "",
    end: found[2],
    text: words.join(" "),
    link: link?.[1],
    id,
  };
}

export function formatSession(session: Session): string {
  const parts = [`${session.start}-${session.end ?? ""}`.padEnd(CLOCKS)];
  if (session.text !== "") parts.push(session.text);
  if (session.link !== undefined) parts.push(`[[${session.link}]]`);
  if (session.id !== undefined) parts.push(session.id);
  return `- ${parts.join(" ")}`;
}

const DURATION = /^(?:(\d+)h)?(?:(\d+)m)?$/;

/** `2h`, `45m` or `1h20m` in minutes. Null for anything else, `45` included. */
export function parseDuration(text: string): number | null {
  const found = DURATION.exec(text);
  // The pattern is every part optional, so the empty string matches it and
  // means nothing. Both parts absent is what that looks like from here.
  if (found === null || (found[1] === undefined && found[2] === undefined)) return null;
  return Number(found[1] ?? 0) * 60 + Number(found[2] ?? 0);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
}

function clock(time: string): number {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/**
 * The minutes from one clock to the other, floored at zero.
 *
 * An end before its start can only be typed, and a negative interval taken into
 * a total would be a number nobody can account for. Zero is visible on the line
 * that caused it.
 */
export function minutesBetween(start: string, end: string): number {
  return Math.max(0, clock(end) - clock(start));
}
