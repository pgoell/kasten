import { useState } from "react";
import type { SearchHit } from "@/lib/api";
import { isOpen, parseTodo } from "@/lib/todo";
import { rowKey } from "@/lib/use-todo-rows";

/**
 * The picker a `b` press opens: the list becomes the choice of what blocks the
 * row, and the choice goes to `onBlock` with the two lines.
 */
export function useBlockerPick(onBlock: (hit: SearchHit, blocker: SearchHit) => void) {
  /**
   * The row `b` was pressed on, while the list is the picker of what blocks it.
   *
   * The pane is its own picker: the rows are already every todo there is to
   * name, and the filter line already narrows them.
   */
  const [picking, setPicking] = useState<SearchHit | null>(null);

  return {
    picking,
    /** `b`: the list becomes the picker of what blocks this row. Finished work waits for nothing. */
    block(hit: SearchHit): boolean {
      const todo = parseTodo(hit.text);
      if (todo === null || !isOpen(todo)) return false;
      setPicking(hit);
      return true;
    },
    /** The row picked as the blocker. One that cannot be it leaves the picker open. */
    pick(blocker: SearchHit) {
      if (picking === null) return;
      // A todo does not wait for itself, nor twice for the same one.
      if (rowKey(blocker) === rowKey(picking)) return;
      const id = parseTodo(blocker.text)?.id;
      if (id !== undefined && parseTodo(picking.text)?.blockedBy.includes(id)) return;

      onBlock(picking, blocker);
      setPicking(null);
    },
    cancel() {
      setPicking(null);
    },
  };
}
