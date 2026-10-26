import { useEffect, useMemo, useState } from "react";
import type { TodoHit } from "@/lib/api";
import {
  type HeldGroup,
  type HeldRow,
  holdOrder,
  identities,
  sameOrder,
  snapshot,
} from "@/lib/todo-hold";
import { heldFold } from "@/lib/todo-scope";
import { type Mode, type Row, rowKey } from "@/lib/use-todo-rows";

/**
 * The order the pane draws its rows in while a press holds it.
 *
 * The open groups and the Done this week fold each keep their own hold, since
 * the fold is no group the open list holds. A press on a row keeps every other
 * row where it was, so a todo checked off does not pull the rows under it up
 * while the reader is aiming at the next one. `release` lets the hold go, so
 * the list is drawn fresh the next time.
 */
export function useTodoHold(o: {
  data: TodoHit[] | undefined;
  /** The open groups as the rows answer them, before any hold. */
  current: { heading: string; rows: Row[] }[];
  /** Done this week as the rows answer it, before any hold. */
  doneWeek: Row[];
  listed: Mode;
  board: boolean;
  doneOpen: boolean;
}) {
  const { data, current, doneWeek, listed, board, doneOpen } = o;

  const [hold, setHold] = useState<HeldGroup[] | null>(null);
  /**
   * The Done this week rows as the press that held them found them. Cleared
   * with `hold`, so the fold is drawn fresh whenever the list is.
   */
  const [foldHeld, setFoldHeld] = useState<HeldRow[] | null>(null);
  const ids = useMemo(() => identities(data ?? []), [data]);
  const holding = useMemo(
    () => (hold === null ? null : holdOrder(hold, current, data ?? [], ids)),
    [hold, current, data, ids],
  );
  const groups = useMemo(
    () =>
      holding === null
        ? current
        : holding.map((group) => ({
            heading: group.heading,
            rows: group.rows.map((each) => each.row),
          })),
    [holding, current],
  );
  const groupRows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  // The open rows drawn now, by identity. A row the open list draws is left out
  // of the fold, so a row checked off while the fold is open is drawn once.
  const kept = useMemo(
    () => new Set(groupRows.map((row) => ids.get(rowKey(row.hit)) ?? rowKey(row.hit))),
    [groupRows, ids],
  );
  const foldRows = useMemo(
    () => heldFold(foldHeld, doneWeek, kept, data ?? [], ids),
    [foldHeld, doneWeek, kept, data, ids],
  );

  // What was drawn becomes the hold, so a row that arrives later takes its place
  // at the end of its group rather than wherever the answer put it. Kept as it
  // was where the rows are the same, so this does not render again.
  useEffect(() => {
    if (holding === null) return;
    setHold((previous) => (previous === null || sameOrder(previous, holding) ? previous : holding));
  }, [holding]);

  // Dropped with the hold, so the next press takes a fresh look at the fold.
  useEffect(() => {
    if (hold === null) setFoldHeld(null);
  }, [hold]);

  /** The first press of the open list holds the order it is drawn in, the fold's too while it is open. */
  function holdNow() {
    if (listed !== "open" || board) return;
    setHold((previous) => previous ?? snapshot(current, ids));
    if (doneOpen) {
      setFoldHeld(
        (previous) => previous ?? snapshot([{ heading: "", rows: doneWeek }], ids)[0]?.rows ?? [],
      );
    }
  }

  /** A write from a row, held first, so the row it changes is still where it was drawn. */
  function pressing<A extends unknown[]>(press: (...args: A) => void) {
    return (...args: A) => {
      holdNow();
      press(...args);
    };
  }

  return {
    groups,
    groupRows,
    foldRows,
    pressing,
    /** Lets the hold go, so the list is drawn fresh. */
    release: () => setHold(null),
  };
}
