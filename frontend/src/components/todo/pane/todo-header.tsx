import type { RefObject } from "react";
import type { SearchHit } from "@/lib/core/api";
import { parseTodo } from "@/lib/todo/todo";
import { KINDS } from "@/lib/todo/todo-board";
import type { Mode } from "@/lib/todo/use-todo-rows";
import { INPUT, LABEL } from "@/lib/ui/overlay-styles";

/**
 * A chip or the shared toggle: a pill with a rule around it, filled with the
 * accent wash when it is the one pressed. It presses down like a button does,
 * and never waits on the motion setting to be told so.
 */
const CHIP =
  "shrink-0 rounded-full border px-2.5 py-0.5 touch-manipulation transition-transform duration-[var(--k-press-in)] active:scale-[var(--k-press-scale)] motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:min-h-11 pointer-coarse:px-3";

/**
 * The pane's top: the filter line with the view's name, then one line holding
 * the list switches, the kind chips and the shared toggle, then the picker's
 * question while one is open.
 */
export function TodoHeader(p: {
  filter: RefObject<HTMLInputElement | null>;
  line: string;
  onType(v: string): void;
  onFiltered(): void;
  named?: string;
  coarse: boolean;
  onAdd(): void;
  picking: SearchHit | null;
  onCancelPick(): void;
  mode: Mode;
  board: boolean;
  strip: { done(): void; next(): void; view(): void; board(): void };
  /** The kind the chips name, or null for All. */
  kind: string | null;
  onKind(kind: string | null): void;
  shared: boolean;
  /** How many rows the shared lists would add, which the toggle says while they are hidden. */
  sharedHidden: number;
  onShared(): void;
}) {
  const {
    filter,
    line,
    onType,
    onFiltered,
    named,
    coarse,
    onAdd,
    picking,
    onCancelPick,
    mode,
    board,
    strip,
    kind,
    onKind,
    shared,
    sharedHidden,
    onShared,
  } = p;
  /** The strip's buttons: a tap's height by finger, a line's by mouse. */
  const pad = coarse ? "min-h-11 px-3" : "px-2 py-1";
  const tab = (on: boolean) =>
    `${pad} shrink-0 border-b-2 ${on ? "border-k-accent text-k-ink" : "border-transparent"}`;

  return (
    <>
      {/* A phone's tab already says todos, so the label goes there to give the filter room. */}
      <header className="flex items-center gap-3 border-b border-k-rule px-3 py-1 font-sans">
        {!coarse && <span className={LABEL}>todos</span>}
        <input
          ref={filter}
          value={line}
          // A keystroke here carries the view's terms into `typed` whole, so
          // the line goes on saying what the list is filtered by and the header
          // stops naming a view it no longer holds.
          onChange={(event) => onType(event.target.value)}
          // Both ways out of the input, and both leave the filter applied.
          onKeyDown={(event) => {
            if (event.key !== "Escape" && event.key !== "Enter") return;
            event.preventDefault();
            onFiltered();
          }}
          aria-label="filter todos"
          placeholder="filter"
          autoComplete="off"
          spellCheck={false}
          className={`${INPUT} placeholder:text-k-muted/70`}
        />
        {named !== undefined && (
          <span data-testid="todo-view" className={LABEL}>
            {named}
          </span>
        )}
        {coarse && (
          <button
            type="button"
            onClick={onAdd}
            aria-label="add todo"
            className="min-h-11 min-w-11 shrink-0 text-lg text-k-muted"
          >
            +
          </button>
        )}
      </header>

      {/* d n v c on every pointer, since nothing else on a desktop says the board
          exists (#419); out of the tab order, the cursor row being the pane's one stop. */}
      <div className="flex items-center overflow-x-auto border-b border-k-rule px-1 font-sans text-[12px] whitespace-nowrap text-k-muted [scrollbar-width:none]">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => strip.done()}
          aria-pressed={mode === "done"}
          className={tab(mode === "done")}
        >
          {coarse ? "done" : "d done"}
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => strip.next()}
          aria-pressed={mode === "next"}
          className={tab(mode === "next")}
        >
          {coarse ? "next" : "n next"}
        </button>
        <button type="button" tabIndex={-1} onClick={() => strip.view()} className={tab(false)}>
          {coarse ? "view" : "v view"}
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => strip.board()}
          aria-pressed={board}
          className={tab(board)}
        >
          {coarse ? "board" : "c board"}
        </button>
        <span aria-hidden="true" className="mx-2 h-4 w-px shrink-0 bg-k-rule" />
        {/* Marked so a test reading the strip by its buttons can tell these
            scope buttons from the list's own; they are not rows or strip keys. */}
        <div data-todo-scope="" className="flex items-center gap-1.5 py-1 pr-2">
          {[null, ...KINDS].map((chip) => (
            <button
              key={chip ?? "all"}
              type="button"
              tabIndex={-1}
              onClick={() => onKind(chip)}
              aria-pressed={kind === chip}
              className={`${CHIP} ${
                kind === chip
                  ? "border-k-accent bg-k-accent-wash text-k-ink"
                  : "border-k-rule text-k-muted"
              }`}
            >
              {chip ?? "All"}
            </button>
          ))}
          {/* Nothing to hide, nothing to say: the toggle shows only once it would change the list. */}
          {(shared || sharedHidden > 0) && (
            <button
              type="button"
              tabIndex={-1}
              onClick={onShared}
              aria-pressed={shared}
              className={`${CHIP} ${
                shared
                  ? "border-k-accent bg-k-accent-wash text-k-ink"
                  : "border-k-rule text-k-muted"
              }`}
            >
              {shared ? "Shared lists, shown" : `Shared lists, ${sharedHidden} hidden`}
            </button>
          )}
        </div>
      </div>

      {/* What the list is for while it is a picker, and whose blocker it is
          picking. A line of its own, so a narrow header loses no filter. */}
      {picking !== null && (
        <div
          data-testid="todo-pick"
          className="flex items-center gap-3 border-b border-k-rule px-3 text-[11px] text-k-accent"
        >
          <span className="min-w-0 flex-1 truncate py-1">
            ⛔ pick what blocks: {parseTodo(picking.text)?.text}
          </span>
          {coarse && (
            <button
              type="button"
              tabIndex={-1}
              onClick={onCancelPick}
              className="min-h-11 shrink-0 px-3 text-k-muted"
            >
              cancel
            </button>
          )}
        </div>
      )}
    </>
  );
}
