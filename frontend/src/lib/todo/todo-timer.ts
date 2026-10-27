/**
 * One press of `t`: the session it starts or stops, and the notes that carry it.
 *
 * Pure, as `todo-write.ts` is. The log lines themselves are read and written by
 * `todo-time.ts`; this module decides which of them a press touches.
 */

import { appendUnder } from "@/lib/note-section";
import { dailyDate } from "@/lib/periodic";
import { parseTodo, patchLine, type Todo } from "@/lib/todo/todo";
import { withoutBlockId } from "@/lib/todo/todo-fields";
import {
  formatDuration,
  formatSession,
  minutesBetween,
  parseSession,
  type Session,
} from "@/lib/todo/todo-time";
import type { Write } from "@/lib/todo/todo-write";

/** The heading the time log lives under, made on first write as `## Done` is. */
const TIME = "## Time";

/** The latest a session could have run on the day its note is named for. */
const LAST_MINUTE = "23:59";

/** One line `searchNotes` answered with, and the note it was found in. */
export interface SessionHit {
  path: string;
  text: string;
}

export interface TimerInput {
  /** Where the todo lives, and which line it is on, counting from one. */
  path: string;
  line: number;
  /** Today's daily note, which a start writes into. */
  dailyPath: string;
  /**
   * Every note this may rewrite, keyed by path and read once: the todo's own
   * note, today's daily note, and every note holding an open session for it.
   */
  notes: Record<string, string>;
  /**
   * Every session line naming this todo, as `searchNotes(id)` answered with
   * them, running and closed alike. Empty for a todo carrying no id, which
   * nothing can name and so has no sessions.
   */
  sessions: SessionHit[];
  today: string;
  /** The wall clock as `HH:MM`. */
  now: string;
  /** A fresh id, used only when the todo carries none. */
  id: string;
}

/** The session a start writes: the todo's words, where it lives, and its id. */
export function sessionOf(todo: Todo, notePath: string, dailyPath: string, start: string): Session {
  return {
    start,
    text: withoutBlockId(todo.text),
    // A note pointing at itself records nothing, the way `doneLine` has it.
    link: notePath === dailyPath ? undefined : notePath.replace(/\.md$/, ""),
    id: todo.id,
  };
}

/**
 * Close every open session naming `id`, at `end`. Null where none moved.
 *
 * The end clock goes into the line in place, over the running pad, rather than
 * the line being rebuilt from its reading: a rebuild loses the indent, a block
 * id and anything typed after the id, and moves a link out of the words. The
 * pad is the clock's width plus the space after it, so the words stay put.
 */
export function closeSessions(text: string, id: string, end: string): string | null {
  const lines = text.split("\n");
  let moved = false;

  for (const [index, line] of lines.entries()) {
    const session = parseSession(line);
    if (session === null || session.end !== undefined || session.id !== id) continue;
    lines[index] = line.replace(/^([ \t]*- \d{2}:\d{2}-)[ \t]*/, `$1${end} `);
    moved = true;
  }

  return moved ? lines.join("\n") : null;
}

/** Every note one press of `t` changes, in the order they should be sent. */
export function timerWrites(input: TimerInput): Write[] {
  const { path, line, dailyPath, notes, sessions, today, now } = input;

  const own = notes[path] ?? "";
  const lines = own.split("\n");
  const todo = parseTodo(lines[line - 1] ?? "");
  // The line moved, or somebody edited it into prose, as `cycleTodoInVault`
  // bails on the same reading.
  if (todo === null) return [];

  const id = todo.id ?? input.id;

  // `searchNotes` answers with every line holding the id, the task line and the
  // done log line among them, so the id is checked here rather than trusted.
  // A session in a note that is not a daily one is somebody's own log: nothing
  // says which day it belongs to, so kasten leaves it alone.
  const mine = sessions.flatMap((hit) => {
    const session = parseSession(hit.text);
    const day = dailyDate(hit.path);
    if (session === null || session.id !== id || day === null) return [];
    return [{ path: hit.path, day, session }];
  });

  // Keyed by path, so a todo living in today's own note produces one write
  // rather than three that overwrite each other.
  const writes = new Map<string, string>();

  const running = mine.filter(({ session }) => session.end === undefined);
  if (running.length === 0) {
    // The session line has to name something, so a start stamps an id the way
    // entering done does.
    if (todo.id === undefined) {
      lines[line - 1] = patchLine(lines[line - 1] ?? "", { ...todo, id });
      writes.set(path, lines.join("\n"));
    }

    const daily = writes.get(dailyPath) ?? notes[dailyPath] ?? "";
    const session = sessionOf({ ...todo, id }, path, dailyPath, now);
    writes.set(dailyPath, appendUnder(daily, TIME, formatSession(session)));

    return [...writes].map(([writePath, writeText]) => ({ path: writePath, text: writeText }));
  }

  // One rule for the timer somebody forgot and for the one that crossed
  // midnight: a session is closed in the note it lives in, at the last minute of
  // the day that note stands for. Every session in one note shares its day.
  const end = (day: string) => (day === today ? now : LAST_MINUTE);

  for (const [notePath, day] of new Map(running.map((found) => [found.path, found.day]))) {
    const closed = closeSessions(writes.get(notePath) ?? notes[notePath] ?? "", id, end(day));
    if (closed !== null) writes.set(notePath, closed);
  }

  // The log is the record, and `⏱` is kasten's summary of it: every stop sums
  // the whole log rather than adding this session to whatever the line carried,
  // so correcting a session line by hand puts the total back in step.
  const total = mine.reduce(
    (sum, { session, day }) => sum + minutesBetween(session.start, session.end ?? end(day)),
    0,
  );

  // The text as the closes left it, because a todo living in today's own note
  // is both the note being closed in and the note carrying the task line.
  const after = (writes.get(path) ?? own).split("\n");
  after[line - 1] = patchLine(after[line - 1] ?? "", {
    ...todo,
    id,
    worked: formatDuration(total),
  });
  writes.set(path, after.join("\n"));

  return [...writes].map(([writePath, writeText]) => ({ path: writePath, text: writeText }));
}
