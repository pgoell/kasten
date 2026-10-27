/**
 * What a card dropped on the board asks the vault to do (#397).
 *
 * Pure, so the rules read and test apart from the pointer that carries the
 * card. A drop answers with a state or a project and nothing else: the board
 * has no stored order, so no position is written.
 */

import type { TodoState } from "@/lib/todo/todo";
import type { Column } from "@/lib/todo/todo-board";

/** A cell of the board: the lane's id, `""` for "No project" or "No kind", and the column. */
export interface Spot {
  lane: string;
  column: Column;
}

export type Drop =
  | { kind: "none" }
  | { kind: "state"; state: TodoState }
  | { kind: "refile"; project: string }
  | { kind: "refused"; why: string };

/**
 * The write a card carried from `from` to `to` makes.
 *
 * `pinned` is a card a `#p/x` tag files: the backend reads the tag first, so a
 * refile elsewhere would draw the card straight back to the lane it left.
 */
export function dropOf(from: Spot, to: Spot, byProject: boolean, pinned: boolean): Drop {
  const column = from.column !== to.column;
  const lane = from.lane !== to.lane;
  // Lanes by kind: a drop writes no kind tag, so only the column counts.
  if (!byProject || !lane) return column ? { kind: "state", state: to.column } : { kind: "none" };
  // Two moves at once, and a half done one is harder to read than none.
  if (column) {
    return {
      kind: "refused",
      why: "Nothing moved: drop in the same column to refile, or in the same lane to set the state",
    };
  }
  if (to.lane === "") {
    return { kind: "refused", why: "Nothing moved: there is no project to file it into" };
  }
  if (pinned) return { kind: "refused", why: "Nothing moved: its #p tag decides its lane" };
  return { kind: "refile", project: to.lane };
}

/** Whether one of `tags` is a `#p/x`, which the backend files a todo by before anything else. */
export function pinnedBy(tags: string[]): boolean {
  return tags.some((tag) => tag.slice(1, 3).toLowerCase() === "p/");
}
