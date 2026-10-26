import { chipNote, PersonChip } from "@/components/person-chip";
import { TodoStateBox } from "@/components/todo-state-box";
import { isOpen, PRIORITY_SYMBOL, type Todo } from "@/lib/todo";
import { laneName } from "@/lib/todo-board";
import { isClient, waitOf, waitsFor } from "@/lib/todo-view";
import { type Row, type RowFacts, rowKey } from "@/lib/use-todo-rows";

/** What a row of client work carries, beside its priority. */
const CLIENT_MARK = "◆";

/**
 * The mark a row with a timer going carries, and nothing where none is.
 *
 * The day comes with it where the session was opened on an earlier one, which
 * is how a timer nobody stopped is drawn as unstopped. The year is left off:
 * every other date on a row is cut the same way.
 */
function timerMark(day: string | undefined, today: string): string | null {
  if (day === undefined) return null;
  return day === today ? "▶" : `▶ ${day.slice(5)}`;
}

/** What a row says about the two clocks: worked, estimated, both or neither. */
function clocks(todo: Todo): string | null {
  if (todo.worked !== undefined && todo.estimate !== undefined) {
    return `⏱ ${todo.worked} / ${todo.estimate}`;
  }
  if (todo.worked !== undefined) return `⏱ ${todo.worked}`;
  if (todo.estimate !== undefined) return `⏲ ${todo.estimate}`;
  return null;
}

/**
 * The words of a todo with the tags that trail them taken off, because the
 * meta line shows those tags beside the row. A tag inside the sentence stays,
 * since it is part of what the sentence says. A todo made of nothing but tags
 * keeps its text, so the row is never blank.
 */
export function wordsOf(text: string, tags: string[]): string {
  const words = text.split(" ");
  while (words.length > 0 && tags.includes(words[words.length - 1] ?? "")) words.pop();
  const rest = words.join(" ").trimEnd();
  return rest === "" ? text : rest;
}

/**
 * The keyboard cursor, an outline only. A tint on the ground would sit under
 * the muted and danger text and push it below 4.5:1, so the row keeps its
 * ground and the outline carries the cursor.
 */
const CURSOR = [
  "outline-1 -outline-offset-1 outline-k-accent/45",
  "focus:outline-2 focus:outline-k-accent",
].join(" ");

/**
 * One row of the list: the line as a button that opens its note.
 *
 * Two lines: the words, and under them a meta line in the smaller, muted face
 * that says what else the todo carries. The date is at the right, in the
 * danger colour once it is past. The row sits on the pane's ground and never
 * on a surface: `--k-danger` reads 4.34:1 on `--k-surface`, short of 4.5.
 */
export function TodoRow({
  row,
  facts,
  today,
  cursor,
  muted,
  coarse,
  indent,
  files,
  onClick,
  onPerson,
  enter,
}: {
  row: Row;
  facts: RowFacts;
  today: string;
  cursor: boolean;
  muted: boolean;
  coarse: boolean;
  indent: React.CSSProperties;
  /** Every path in the vault, which the assignee's chip resolves its note against. */
  files: string[];
  onClick(): void;
  /** Opens the person note a chip on the row names. */
  onPerson(path: string): void;
  /** Set on a row of the first load, the place it staggers in at. */
  enter?: number;
}) {
  const { hit, todo, under, struck } = row;
  const key = rowKey(hit);
  const mark = timerMark(todo.id === undefined ? undefined : facts.running.get(todo.id), today);
  const time = clocks(todo);
  const wait = waitOf(todo, today);
  const blockers = waitsFor(todo, facts.links.named, facts.links.closed);
  const dependents =
    todo.id !== undefined && isOpen(todo) ? facts.links.dependents.get(todo.id) : undefined;
  const progress = facts.progress.get(key);
  // A row with nothing for its meta line draws none, so a bare todo is one line.
  // A row the answer left no project on reads as none, undefined as null.
  const meta =
    hit.project != null ||
    todo.tags.length > 0 ||
    todo.assignee !== undefined ||
    wait !== null ||
    blockers.length > 0 ||
    dependents !== undefined ||
    progress !== undefined ||
    time !== null;
  // A date that is past on a todo still open. A finished one is a record, not a debt.
  const overdue = todo.due !== undefined && isOpen(todo) && todo.due < today;

  return (
    <button
      type="button"
      data-row={key}
      tabIndex={cursor ? 0 : -1}
      // A tap is Enter by finger, and takes the row as Enter does. A chip
      // on the row takes its own press: the person's note, not the todo's.
      onClick={(event) => {
        const note = chipNote(event.target);
        if (note === null) onClick();
        else onPerson(note);
      }}
      title={key}
      // The state button in front carries the indent on touch.
      style={{
        ...(coarse ? { paddingLeft: 0 } : indent),
        ...(enter === undefined ? {} : ({ "--i": enter } as React.CSSProperties)),
      }}
      // A blocked row is drawn muted rather than gathered under a
      // heading of its own: its state is written on the line, and
      // the date group is still where the work belongs. A waiting
      // row is held the same way, by a person rather than a todo.
      className={`k-row flex w-full min-w-0 max-w-[52rem] cursor-pointer items-start gap-2 px-3 py-[3px] text-left font-sans ${muted ? "text-k-muted" : "text-k-ink"} ${cursor ? CURSOR : ""} ${coarse ? "min-h-11" : ""} ${enter === undefined ? "" : "k-enter"}`}
    >
      {/* On touch the state button in front of the row carries the box instead. */}
      {/* Top-aligned with the words, the way the touch button is, so the box
        sits on the line the words are on and not between the two lines. */}
      {!coarse && (
        <span className="mt-[3px] flex shrink-0">
          <TodoStateBox state={todo.state} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2 text-k-15">
          {/* Leftmost of what a row carries beyond its state, so
            scanning the list finds what is going. */}
          {mark !== null && <span className="shrink-0 text-k-ok">{mark}</span>}
          {/* Between the state and the words, where the spec's mock
            puts it, and absent rather than blank on a row that
            carries none. */}
          {todo.priority !== undefined && (
            <span className="shrink-0">{PRIORITY_SYMBOL[todo.priority]}</span>
          )}
          {/* Drawn as well as left in the words, because a part takes
            the mark off its parent and has no tag to show. */}
          {isClient(todo) && (
            <span title="client work" className="shrink-0 text-k-accent">
              {CLIENT_MARK}
            </span>
          )}
          {/* What this is a part of, in front of the part itself, so
            a next action reads as work on something. Muted: the row
            is about the action, and this says where it sits. */}
          {under !== undefined && (
            <span className="max-w-[40%] shrink-0 truncate text-k-muted">{under}</span>
          )}
          {/* Struck while it stays in the list it was checked off in, so the
            words say what was done without the row moving under the finger. */}
          <span
            className={`min-w-[8ch] flex-1 truncate ${struck ? "text-k-muted line-through" : ""}`}
          >
            {wordsOf(todo.text, todo.tags)}
          </span>
        </span>
        {meta && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-k-12 text-k-muted">
            {hit.project != null && <span className="shrink-0">{laneName(hit.project)}</span>}
            {todo.tags.length > 0 && <span className="shrink-0">{todo.tags.join(" ")}</span>}
            {/* Who the todo is for, out of the words' truncation the way the date is
              kept, and the one chip of the person's note (#809). */}
            {todo.assignee !== undefined && <PersonChip assignee={todo.assignee} paths={files} />}
            {/* Who a waiting row is on and for how many days, taken off
              the line's `👤`. */}
            {wait !== null && <span className="max-w-[40%] truncate">{wait}</span>}
            {/* What the row waits for: the blocker's words where there
              is one, a count where there are more, and every one of
              them in the title. Nothing for a blocker already closed. */}
            {blockers.length > 0 && (
              <span title={`waits for:\n${blockers.join("\n")}`} className="max-w-[40%] truncate">
                ⛔ {blockers.length === 1 ? blockers[0] : blockers.length}
              </span>
            )}
            {/* And what waits for it, as a count: the words are on the
              rows that wait. */}
            {dependents !== undefined && (
              <span
                title={`blocks:\n${dependents.map((one) => one.text).join("\n")}`}
                className="shrink-0"
              >
                → {dependents.length}
              </span>
            )}
            {progress !== undefined && <span className="shrink-0">{progress}</span>}
            {/* What is on the line, not a sum: a running session lands here
              when it is stopped. */}
            {time !== null && <span className="shrink-0">{time}</span>}
          </span>
        )}
      </span>
      {/* Out of the truncation, so a long todo loses its words
        rather than the date they are due on. The year is cut
        from a date inside this one, where every row shares it,
        and kept on any other: `Later` reaches years out, and
        two rows reading `01-01` say nothing about which is
        sooner. */}
      {todo.due !== undefined && (
        <span
          className={`shrink-0 text-k-13 tabular-nums ${overdue ? "text-k-danger" : "text-k-muted"}`}
        >
          {todo.due.startsWith(today.slice(0, 4)) ? todo.due.slice(5) : todo.due}
        </span>
      )}
    </button>
  );
}
