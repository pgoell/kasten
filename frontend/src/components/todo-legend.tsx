import { STATE_ORDER, TodoStateBox } from "@/components/todo-state-box";
import type { TodoState } from "@/lib/todo/todo";

/**
 * The count per state, beside the box that draws it. Wraps rather than scrolls sideways.
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
