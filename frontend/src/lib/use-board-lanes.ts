import { useMemo } from "react";
import type { SearchHit, TodoHit } from "@/lib/api";
import type { Todo } from "@/lib/todo";
import { COLUMNS, columnOf, KINDS, kindOf, laneName } from "@/lib/todo-board";
import type { Placed } from "@/lib/todo-view";

/** The key a board card is known by, `path:line`. */
export function cardKey(hit: SearchHit): string {
  return `${hit.path}:${hit.line}`;
}

interface Lane<C> {
  /** The project's whole path or the kind, since two roots can hold a folder of one name. */
  id: string;
  name: string;
  /** The lane's cards, one list per column, in `COLUMNS` order. */
  cells: C[][];
}

/**
 * The lanes and columns the board draws the cards in. `ancestors` is what each
 * card hangs off, nearest first, which kind walks up.
 */
export function useBoardLanes<C extends { hit: TodoHit; todo: Todo }>(
  cards: C[],
  parents: Map<string, Placed>,
  byProject: boolean,
): { ancestors: Map<string, Placed[]>; lanes: Lane<C>[]; columns: C[][] } {
  // The todos above each card, nearest first, off the whole forest rather than
  // the cards: a parent the filter hid still gives its part a kind.
  const ancestors = useMemo(() => {
    const walk = (hit: SearchHit) => {
      const found: Placed[] = [];
      for (
        let up = parents.get(cardKey(hit));
        up !== undefined;
        up = parents.get(`${hit.path}:${up.line}`)
      ) {
        found.push(up);
      }
      return found;
    };
    return new Map(cards.map((card) => [cardKey(card.hit), walk(card.hit)]));
  }, [cards, parents]);

  const lanes = useMemo((): Lane<C>[] => {
    const laneOf = (card: C): string | null => {
      // The backend's answer, so an agent reading `/api/todos` sees the lane
      // drawn here and no second copy of the rule can drift from it.
      if (byProject) return card.hit.project;
      const above = ancestors.get(cardKey(card.hit)) ?? [];
      return kindOf(
        card.todo,
        above.map((one) => one.todo),
      );
    };

    const groups = new Map<string | null, C[]>();
    for (const card of cards) {
      const lane = laneOf(card);
      groups.set(lane, [...(groups.get(lane) ?? []), card]);
    }

    // By kind: the three in their fixed order, then the rest. By project: the
    // pile still to sort first, as the inbox is in Things, then by name.
    const order = byProject
      ? [...groups.keys()].sort((a, b) =>
          a === null ? -1 : b === null ? 1 : laneName(a).localeCompare(laneName(b)),
        )
      : [...KINDS, null].filter((kind) => groups.has(kind));

    return order.map((lane) => {
      const members = groups.get(lane) ?? [];
      return {
        id: lane ?? "",
        name: byProject ? laneName(lane) : (lane ?? "No kind"),
        cells: COLUMNS.map((column) => members.filter(({ todo }) => columnOf(todo) === column)),
      };
    });
  }, [cards, ancestors, byProject]);

  // A column's cards top to bottom across the lanes, which is what `j` and `k` walk.
  const columns = useMemo(
    () => COLUMNS.map((_, index) => lanes.flatMap((lane) => lane.cells[index] ?? [])),
    [lanes],
  );

  return { ancestors, lanes, columns };
}
