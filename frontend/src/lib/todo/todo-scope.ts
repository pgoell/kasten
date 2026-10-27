import type { TodoHit } from "@/lib/api";
import { parseTodo } from "@/lib/todo/todo";
import type { HeldRow } from "@/lib/todo/todo-hold";
import { type Row, rowKey } from "@/lib/todo/use-todo-rows";

/**
 * The Done this week rows as the pane draws them while a press holds the order.
 *
 * `held` is the fold as it was drawn when the press came, or null while no
 * press holds it. A held row stays where it was: one still finished is drawn as
 * the vault answers it now, and one that left the fold is drawn struck from the
 * line the vault holds, so a second press still lands on the row it was on. A
 * held row whose line is no longer a todo keeps the row as it was drawn. Rows
 * in `kept` are drawn by the open list, which holds them struck, so they are
 * not drawn twice. Rows the hold has not seen go at the end.
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
