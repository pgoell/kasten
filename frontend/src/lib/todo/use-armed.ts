import { useEffect, useState } from "react";
import type { SearchHit } from "@/lib/core/api";
import { followRow, twinsOf } from "@/lib/todo/todo-turns";
import { rowKey } from "@/lib/todo/use-todo-rows";

/** How long a tapped state button keeps asking before it takes the question back. */
const ARMED_MS = 4000;

/**
 * The question a tapped state button asks: one row at a time, taken back by a
 * tap elsewhere, by a scroll, or by a timeout. `rows` are the rows as drawn now.
 */
export function useArmed(rows: SearchHit[]) {
  // The row tapped once, and which of its twins: a cycle has no way back, so the first tap asks.
  const [asked, setAsked] = useState<{ at: SearchHit; twins: { nth: number; of: number } } | null>(
    null,
  );

  // A question nobody answers is taken back, or a tap minutes later would land
  // as the second of a pair. The cleanup covers a pane that has closed.
  useEffect(() => {
    if (asked === null) return;
    const timer = setTimeout(() => setAsked(null), ARMED_MS);
    return () => clearTimeout(timer);
  }, [asked]);

  // It follows its todo to a new line (a save stamping frontmatter, #2092), never onto another todo.
  const at = asked === null ? null : followRow(asked.at, asked.twins, rows);
  const armed = at === null ? null : `${rowKey(at)}\n${at.text}`;

  return {
    armed,
    arm(hit: SearchHit | null) {
      setAsked(hit === null ? null : { at: hit, twins: twinsOf(hit, rows) });
    },
    // A tap anywhere but on the armed button itself takes the question back,
    // before the tap does whatever it was for.
    disarmElsewhere(event: React.PointerEvent) {
      if (armed !== null && !(event.target as Element).closest("[data-armed]")) setAsked(null);
    },
  };
}
