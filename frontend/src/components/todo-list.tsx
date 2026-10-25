import { useState } from "react";
import { TodoHints } from "@/components/todo-hints";
import { TodoMore } from "@/components/todo-more";
import { TodoRow } from "@/components/todo-row";
import type { SearchHit, TodoHit } from "@/lib/api";
import { useEntrance } from "@/lib/stagger";
import { cycleLine, parseTodo, STATE_SYMBOL } from "@/lib/todo";
import { lineSuggestions } from "@/lib/todo-suggest";
import { type Row, type RowFacts, rowKey } from "@/lib/use-todo-rows";

/** How far one step of nesting shifts a row, in `rem`, past the list's own padding. */
const STEP = 1.1;

/** The padding `ROW` carries, which a nested row has to start from. */
const GUTTER = 0.75;

/**
 * The list of rows under their headings: the row itself, and on touch the
 * state button and `⋯` beside it, with the input a row turns into while it is
 * edited.
 */
export function TodoList(p: {
  groups: { heading: string; rows: Row[] }[];
  /** What the list says in place of its rows, where it has none. */
  empty: string | null;
  cursorKey: string;
  facts: RowFacts;
  today: string;
  coarse: boolean;
  picking: boolean;
  editing: { key: string; line: string } | null;
  onEditing(e: { key: string; line: string } | null): void;
  draft: React.RefObject<HTMLInputElement | null>;
  armed: string | null;
  onArm(key: string | null): void;
  onRow(hit: SearchHit): void;
  /** Every path in the vault, which a row's assignee chip resolves its note against. */
  files: string[];
  onPerson(path: string): void;
  onWrite(hit: SearchHit, line: string): void;
  onCycle(hit: SearchHit): void;
  actions(hit: TodoHit): [string, () => void][];
}) {
  const {
    groups,
    empty,
    cursorKey,
    facts,
    today,
    coarse,
    picking,
    editing,
    onEditing,
    draft,
    armed,
    onArm,
    onRow,
    files,
    onPerson,
    onWrite,
    onCycle,
    actions,
  } = p;
  /**
   * The row whose `⋯` is open, or null: one strip at a time. By its key and
   * its text, as `armed` is and for its reason: the strip's states write on
   * one tap, and must not write to a todo that has since taken the line.
   */
  const [more, setMore] = useState<string | null>(null);
  // The rows of the first list to arrive stagger in, and a row added later
  // appears at once. `place` is each row's index down the whole list.
  const keys = groups.flatMap((group) => group.rows.map((row) => rowKey(row.hit)));
  const entering = useEntrance(keys);
  const place = new Map(keys.map((key, index) => [key, index]));

  return (
    /* A list that moves under the finger has moved the armed row with it. */
    <div className="flex-1 overflow-auto py-1" onScroll={() => onArm(null)}>
      {empty !== null ? (
        <p className="px-3 py-1 text-[13px] text-k-muted">{empty}</p>
      ) : (
        groups.map(({ heading, rows: group }) => (
          <div key={heading}>
            <h3 className="px-3 pt-2 pb-1 text-[11px] tracking-wider text-k-muted uppercase">
              {heading}
            </h3>
            {group.map((row) => {
              const { hit, todo, depth } = row;
              const key = rowKey(hit);
              // Not review: what it waits on is the owner's own eye, so it
              // is drawn at full strength rather than faded out of sight.
              const held = todo.state === "blocked" || todo.state === "waiting";
              // A step in per level of nesting, so the list reads the way the
              // note does. `ROW` carries the first one as padding.
              const indent = { paddingLeft: `${GUTTER + (depth ?? 0) * STEP}rem` };

              // The whole row, because the whole line is what is edited: the
              // box and every field are on it, and the symbols this draws in
              // their place are a reading of the line rather than the line.
              if (key === editing?.key) {
                return (
                  <div key={key}>
                    <input
                      ref={draft}
                      value={editing.line}
                      onChange={(event) => onEditing({ key, line: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== "Escape") return;
                        event.preventDefault();
                        // Nothing left in it is nothing to write. Deleting a
                        // todo is not what this key is.
                        if (event.key === "Enter" && editing.line.trim() !== "") {
                          onWrite(hit, editing.line);
                        }
                        onEditing(null);
                      }}
                      aria-label="edit line"
                      autoComplete="off"
                      spellCheck={false}
                      style={indent}
                      // Its own classes rather than `ROW` and `INPUT`: the
                      // overlay input is written to disappear into a panel,
                      // `outline-none` and `bg-transparent`, and both of those
                      // win over the two things this row has to say. It is a
                      // row of the list, at the list's size, wearing the
                      // keyboard cursor's own outline, because this row is
                      // where the keys are going.
                      className="w-full bg-k-accent/15 px-3 py-[3px] text-[13px] text-k-ink outline-2 -outline-offset-1 outline-k-accent pointer-coarse:text-base"
                    />
                    <TodoHints
                      found={lineSuggestions(editing.line, today, true)}
                      line={editing.line}
                      onTake={(edited) => {
                        onEditing({ key, line: edited });
                        // Back to the line, so the next thing typed carries on
                        // where the hint left off rather than into a button.
                        draft.current?.focus();
                      }}
                    />
                  </div>
                );
              }

              if (!coarse) {
                return (
                  <TodoRow
                    key={key}
                    row={row}
                    facts={facts}
                    today={today}
                    cursor={key === cursorKey}
                    muted={held}
                    coarse={coarse}
                    indent={indent}
                    files={files}
                    onClick={() => onRow(hit)}
                    // Picking a blocker, a chip is the row it sits on, as the row is.
                    onPerson={(path) => (picking ? onRow(hit) : onPerson(path))}
                    enter={entering(key) ? place.get(key) : undefined}
                  />
                );
              }

              // The state drawn as a button of its own, beside the row
              // rather than inside it: a tap on the row opens the note, and
              // a button cannot hold another. Out of the tab order, so the
              // row is still the pane's one stop. `⋯` trails it for the
              // same reason, and holds every key that has no button yet.
              // One key for the question and for the strip: the row's own
              // and its text, so neither is carried onto another todo that a
              // write from elsewhere has put on this line.
              const arming = `${key}\n${hit.text}`;
              const asking = armed === arming;
              const opened = more === arming;
              // What the second tap would leave, drawn so the question says
              // what it is asking. Nothing where the cycle leaves no todo.
              const next = asking ? parseTodo(cycleLine(hit.text, today, ""))?.state : undefined;
              return (
                <TodoMore
                  key={key}
                  name={todo.text}
                  opened={opened}
                  onClose={() => setMore(null)}
                  onToggle={() => {
                    if (picking) return;
                    // The question on a state button, this row's or
                    // another's, is taken back as the strip opens.
                    onArm(null);
                    setMore(opened ? null : arming);
                  }}
                  actions={actions(hit)}
                  enter={entering(key) ? place.get(key) : undefined}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      // A row in the picker is there to be chosen.
                      if (picking) return;
                      onArm(asking ? null : arming);
                      // Two ways to change a state do not both stand
                      // open: the question shuts a strip, as a strip
                      // takes the question back.
                      setMore(null);
                      if (asking) onCycle(hit);
                    }}
                    aria-label={`cycle ${todo.text}`}
                    aria-pressed={asking}
                    data-armed={asking ? "" : undefined}
                    style={indent}
                    className={`min-h-11 min-w-11 shrink-0 pr-2 text-left text-[13px] ${
                      asking ? "text-k-accent" : held ? "text-k-muted" : "text-k-ink"
                    }`}
                  >
                    {asking
                      ? `${next === undefined ? "" : STATE_SYMBOL[next]}?`
                      : STATE_SYMBOL[todo.state]}
                  </button>
                  <TodoRow
                    row={row}
                    facts={facts}
                    today={today}
                    cursor={key === cursorKey}
                    muted={held}
                    coarse={coarse}
                    indent={indent}
                    files={files}
                    onClick={() => onRow(hit)}
                    onPerson={(path) => (picking ? onRow(hit) : onPerson(path))}
                  />
                </TodoMore>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
