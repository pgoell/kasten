import type { Mention, SearchHit } from "@/lib/api";
import { ROW, TAP } from "@/lib/overlay-styles";
import { parseTodo, STATE_SYMBOL } from "@/lib/todo/todo";
import { isMention } from "@/lib/use-search-hits";

/** One row of the list, and beside it a `link` button for an unlinked mention. */
export function SearchRow({
  hit,
  optionId,
  selected,
  todos,
  onOpen,
  onLink,
}: {
  hit: SearchHit | Mention;
  optionId: string;
  selected: boolean;
  todos: boolean;
  onOpen(): void;
  onLink(): void;
}) {
  // Null off todos mode, and on a line the filter cannot parse, which then draws its raw text.
  const todo = todos ? parseTodo(hit.text) : null;
  const option = (
    <button
      id={optionId}
      type="button"
      role="option"
      aria-selected={selected}
      // Out of the tab order: focus stays in the input, and the highlight says what Enter opens.
      tabIndex={-1}
      onClick={onOpen}
      // `min-w-0` lets the path shrink beside the link button, or a long path pushes it off a phone.
      className={`${ROW} ${TAP} flex min-w-0 gap-3 ${selected ? "bg-k-surface" : ""}`}
    >
      <span
        // Capped below `md`, where a long path alone is wider than the list.
        className={`shrink-0 truncate max-md:max-w-[45%] ${selected ? "text-k-accent" : "text-k-muted"}`}
      >
        {hit.path}:{hit.line}
      </span>
      <span className="min-w-0 flex-1 truncate text-k-ink">
        {todo === null ? hit.text : `${STATE_SYMBOL[todo.state]} ${todo.text}`}
      </span>
      {/* Outside the truncation, so a long todo loses words, not its due date. */}
      {todo?.due !== undefined && <span className="shrink-0 text-k-muted">📅 {todo.due}</span>}
    </button>
  );
  if (!isMention(hit)) return option;
  // Beside the row, not inside it: a click inside a button would reach the row too.
  return (
    <div className="flex">
      {option}
      <button
        type="button"
        tabIndex={-1}
        // The press would move focus here, and the keys belong to the input.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onLink}
        className={`${TAP} flex shrink-0 cursor-pointer px-3 text-[11px] text-k-accent hover:bg-k-surface`}
      >
        link
      </button>
    </div>
  );
}
