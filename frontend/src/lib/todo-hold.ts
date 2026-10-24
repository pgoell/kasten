import type { TodoHit } from "@/lib/api";
import { parseTodo, wordTags } from "@/lib/todo";
import { AGENT } from "@/lib/todo-agent";
import { type Row, rowKey } from "@/lib/use-todo-rows";

/** A row the order is held by: what it is, and the row as it was last drawn. */
export interface HeldRow {
  id: string;
  row: Row;
}

export interface HeldGroup {
  heading: string;
  rows: HeldRow[];
}

/**
 * What a row is across the writes that change its line: its note, its words,
 * and which of the note's lines with those words it is, counted in line order.
 *
 * A press stamps an id and dates on its line and can move the lines below it,
 * so the line is no identity. The words survive a press. Counted over every
 * line the vault answered with, in line order, so the answer's own order, which
 * the vault does not promise, cannot change which twin is which.
 */
export function identities(hits: TodoHit[]): Map<string, string> {
  const inOrder = [...hits].sort((one, other) =>
    one.path === other.path ? one.line - other.line : one.path < other.path ? -1 : 1,
  );
  const seen = new Map<string, number>();
  const ids = new Map<string, string>();
  for (const hit of inOrder) {
    const stem = `${hit.path}\n${wordsOf(parseTodo(hit.text)?.text ?? hit.text)}`;
    const nth = seen.get(stem) ?? 0;
    seen.set(stem, nth + 1);
    ids.set(rowKey(hit), `${stem}\n${nth}`);
  }
  return ids;
}

/**
 * The words without their `#agent` tags, the way `@` leaves them: a press puts
 * the tag on a todo and takes it off again, and neither is another todo.
 */
function wordsOf(text: string): string {
  let words = text;
  // Last first, so the offsets of the tags still to go hold.
  for (const { tag, at } of [...wordTags(text)].reverse()) {
    if (tag !== AGENT) continue;
    const start = words[at - 1] === " " ? at - 1 : at;
    words = words.slice(0, start) + words.slice(at + AGENT.length);
  }
  return words;
}

/** The groups as they are drawn, each row with its identity. */
export function snapshot(
  groups: { heading: string; rows: Row[] }[],
  ids: Map<string, string>,
): HeldGroup[] {
  return groups.map((group) => ({
    heading: group.heading,
    rows: group.rows.map((row) => ({ id: idOf(row.hit, ids), row })),
  }));
}

function idOf(hit: TodoHit, ids: Map<string, string>): string {
  return ids.get(rowKey(hit)) ?? rowKey(hit);
}

/**
 * The groups to draw while an order is held.
 *
 * Each held row stays where it was, under the row now carrying its identity in
 * the open list. A row that is no longer open is drawn struck, from the line the
 * vault holds now, so it can be pressed again. A row the vault no longer holds
 * goes. A row the hold has not seen goes at the end of its group, or of a new
 * group at the end.
 */
export function holdOrder(
  held: HeldGroup[],
  groups: { heading: string; rows: Row[] }[],
  hits: TodoHit[],
  ids: Map<string, string>,
): HeldGroup[] {
  const open = new Map<string, Row>();
  for (const group of groups) {
    for (const row of group.rows) open.set(idOf(row.hit, ids), row);
  }
  const answered = new Map<string, TodoHit>();
  for (const hit of hits) answered.set(idOf(hit, ids), hit);

  const used = new Set<string>();
  const drawn: HeldGroup[] = [];
  for (const group of held) {
    const rows: HeldRow[] = [];
    for (const each of group.rows) {
      const now = open.get(each.id);
      const kept =
        now === undefined ? struck(each, answered.get(each.id)) : { id: each.id, row: now };
      if (kept === null) continue;
      rows.push(kept);
      used.add(each.id);
    }
    drawn.push({ heading: group.heading, rows });
  }

  for (const group of groups) {
    for (const row of group.rows) {
      const id = idOf(row.hit, ids);
      if (used.has(id)) continue;
      let target = drawn.find((each) => each.heading === group.heading);
      if (target === undefined) {
        target = { heading: group.heading, rows: [] };
        drawn.push(target);
      }
      target.rows.push({ id, row });
    }
  }
  return drawn.filter((group) => group.rows.length > 0);
}

/** A held row that is no longer open, drawn as the line the vault now holds, struck. */
function struck(each: HeldRow, hit: TodoHit | undefined): HeldRow | null {
  if (hit === undefined) return null;
  const todo = parseTodo(hit.text);
  if (todo === null) return null;
  const { depth, under } = each.row;
  return { id: each.id, row: { hit, todo, depth, under, struck: true } };
}

/** Whether two holds draw the same rows in the same order, so the later one can be dropped. */
export function sameOrder(one: HeldGroup[], other: HeldGroup[]): boolean {
  return (
    one.length === other.length &&
    one.every(
      (group, g) =>
        group.heading === other[g]?.heading &&
        group.rows.length === other[g]?.rows.length &&
        group.rows.every((each, r) => each.id === other[g]?.rows[r]?.id),
    )
  );
}
