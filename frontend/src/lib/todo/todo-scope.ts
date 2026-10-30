import type { TodoHit } from "@/lib/api";
import { parseTodo } from "@/lib/todo/todo";
import type { HeldRow } from "@/lib/todo/todo-hold";
import { type Row, rowKey } from "@/lib/todo/use-todo-rows";

/**
 * The Done this week rows as drawn while a press holds the order. A held row keeps its
 * place, struck if it left the fold, so a second press still lands on it.
 */
export function heldFold(
  held: HeldRow[] | null,
  done: Row[],
  kept: Set<string>,
  hits: TodoHit[],
  ids: Map<string, string>,
): Row[] {
  const idOf = (hit: TodoHit) => ids.get(rowKey(hit)) ?? rowKey(hit);
  if (held === null) return done.filter((row) => !kept.has(idOf(row.hit)));

  const fresh = new Map(done.map((row) => [idOf(row.hit), row]));
  // By place rather than by identity: a line that is no longer a todo has no
  // words to name it by, so its identity is gone with them.
  const byPlace = new Map(hits.map((hit) => [rowKey(hit), hit]));
  const drawn: Row[] = [];
  const seen = new Set<string>();

  for (const each of held) {
    if (kept.has(each.id)) continue;
    seen.add(each.id);
    const now = fresh.get(each.id);
    if (now !== undefined) {
      drawn.push(now);
      continue;
    }
    const hit = byPlace.get(rowKey(each.row.hit));
    if (hit === undefined) continue;
    const todo = parseTodo(hit.text);
    drawn.push(
      todo === null
        ? { ...each.row, struck: true }
        : { hit, todo, depth: each.row.depth, under: each.row.under, struck: true },
    );
  }

  for (const row of done) {
    const id = idOf(row.hit);
    if (seen.has(id) || kept.has(id)) continue;
    drawn.push(row);
  }
  return drawn;
}
