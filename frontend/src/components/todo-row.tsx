import { ROW } from "@/lib/overlay-styles";
import { isOpen, PRIORITY_SYMBOL, STATE_SYMBOL, type Todo } from "@/lib/todo";
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

/** The keyboard cursor, drawn the way the file tree draws its own. */
const CURSOR = [
  "outline-1 -outline-offset-1 outline-k-accent/45",
  "focus:outline-2 focus:outline-k-accent focus:bg-k-accent/15",
].join(" ");

/** One row of the list: the line as a button that opens its note. */
export function TodoRow({
  row,
  facts,
  today,
  cursor,
  muted,
  coarse,
  indent,
  onClick,
  enter,
}: {
  row: Row;
  facts: RowFacts;
  today: string;
  cursor: boolean;
  muted: boolean;
  coarse: boolean;
  indent: React.CSSProperties;
  onClick(): void;
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

  return (
    <button
      type="button"
      data-row={key}
      tabIndex={cursor ? 0 : -1}
      // A tap is Enter by finger, and takes the row as Enter does.
      onClick={onClick}
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
      className={`${ROW} flex gap-2 ${muted ? "text-k-muted" : "text-k-ink"} ${cursor ? CURSOR : ""} ${coarse ? "min-h-11 min-w-0 items-center" : ""} ${enter === undefined ? "" : "k-enter"}`}
    >
      {!coarse && <span className="shrink-0">{STATE_SYMBOL[todo.state]}</span>}
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
      <span className={`min-w-0 flex-1 truncate ${struck ? "text-k-muted line-through" : ""}`}>
        {todo.text}
      </span>
      {/* Between the words and the date, where the spec's mock
        puts it, and out of the truncation for the reason the
        date is: it is the shortest thing on the row. */}
      {facts.progress.has(key) && (
        <span className="shrink-0 text-k-muted">{facts.progress.get(key)}</span>
      )}
      {/* What the row waits for: the blocker's words where there
        is one, a count where there are more, and every one of
        them in the title. Nothing for a blocker already closed. */}
      {blockers.length > 0 && (
        <span
          title={`waits for:\n${blockers.join("\n")}`}
          className="max-w-[40%] shrink-0 truncate text-k-muted"
        >
          ⛔ {blockers.length === 1 ? blockers[0] : blockers.length}
        </span>
      )}
      {/* And what waits for it, as a count: the words are on the
        rows that wait. */}
      {dependents !== undefined && (
        <span
          title={`blocks:\n${dependents.map((one) => one.text).join("\n")}`}
          className="shrink-0 text-k-muted"
        >
          → {dependents.length}
        </span>
      )}
      {/* Who a waiting row is on and for how many days, taken off
        the line's `👤`. */}
      {wait !== null && <span className="max-w-[40%] shrink-0 truncate text-k-muted">{wait}</span>}
      {/* Out of the truncation for the reason the date is. What
        is on the line, not a sum: a running session lands here
        when it is stopped. */}
      {time !== null && <span className="shrink-0 text-k-muted">{time}</span>}
      {/* Out of the truncation, so a long todo loses its words
        rather than the date they are due on. The year is cut
        from a date inside this one, where every row shares it,
        and kept on any other: `Later` reaches years out, and
        two rows reading `01-01` say nothing about which is
        sooner. */}
      {todo.due !== undefined && (
        <span className="shrink-0 text-k-muted">
          {todo.due.startsWith(today.slice(0, 4)) ? todo.due.slice(5) : todo.due}
        </span>
      )}
    </button>
  );
}
