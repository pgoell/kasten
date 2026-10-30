/**
 * A session line, one line of a `## Time` section, read into a record and written back.
 * The line is the record, so durations (`⏲ 2h`, `⏱ 1h20m`) live here beside it.
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

const LINK = /\[\[([^\]]+)\]\]/g;

/**
 * How wide the two clocks are written, `09:12-10:32`. A running line is padded to the same width,
 * so a day's log reads down the page.
 */
const CLOCKS = 11;

export function parseSession(line: string): Session | null {
  const found = LINE.exec(line);
  if (found === null) return null;

  let rest = found[3] ?? "";

  // Last rather than first: `formatSession` writes the link after the words,
  // and a `[[link]]` in the words is something the todo said rather than the
  // note it lives in. A stop no longer rebuilds the line from this reading, so
  // a link written after the id is not worth chasing.
  const link = [...rest.matchAll(LINK)].at(-1);
  if (link !== undefined)
    rest = rest.slice(0, link.index) + rest.slice(link.index + link[0].length);

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
 * Minutes from `start` to `end`, floored at zero, since an end before its start can only be typed.
 */
export function minutesBetween(start: string, end: string): number {
  return Math.max(0, clock(end) - clock(start));
}
