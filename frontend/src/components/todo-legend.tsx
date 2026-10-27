import { STATE_ORDER, TodoStateBox } from "@/components/todo-state-box";
import type { TodoState } from "@/lib/todo/todo";

/**
 * The count per state, each beside the box that draws it, so a box on a row
 * reads without the words. The state's name is the box's label and the row's
 * title, so a reader who does not know a box can point at it.
 *
 * Wraps where the width ends and never scrolls sideways: a phone at 390 px
 * takes it in two lines.
 */
export function TodoLegend({ counts }: { counts: Record<TodoState, number> }) {
  return (
    <ul
      aria-label="legend"
      className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-1 font-sans text-k-12 text-k-muted tabular-nums"
    >
      {STATE_ORDER.map((state) => (
        <li key={state} title={state} className="flex items-center gap-1">
          <TodoStateBox state={state} />
          <span>{counts[state]}</span>
        </li>
      ))}
    </ul>
  );
}
