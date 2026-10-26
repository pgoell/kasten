import { useState } from "react";
import { COLUMNS } from "@/lib/todo-board";

/**
 * Where Rejected sits in the columns. It is folded on a desktop by default, the
 * one column a board folds, since the work done a week ago is rarely what the
 * eye is after.
 */
const REJECTED = COLUMNS.indexOf("rejected");

/**
 * The folds a board keeps in memory: the lanes a tap folded, by id, and the
 * Rejected column. A fold ends a carry, since the cell a card was over may be
 * the one that folds away, so `endDrag` is handed in. `showColumn` moves the
 * shown column, which the board already owns.
 */
export function useBoardFolds(
  col: number,
  showColumn: (index: number) => void,
  endDrag: () => void,
) {
  /**
   * The lanes a tap folded, by id. Memory only, so a reload draws them all open
   * again, as the lanes' own state is kept per mount.
   */
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  /** Whether the Rejected column was unfolded by a click, which `l` onto it also does while the cursor is there. */
  const [rejectedOpen, setRejectedOpen] = useState(false);
  // Rejected is drawn unfolded while the cursor is on it, so `l` opens it, and
  // `h` folds it again by leaving.
  const rejectedDrawn = rejectedOpen || col === REJECTED;

  /** A tap on a lane's heading folds the lane or unfolds it. A carried card is let go first. */
  function toggleLane(id: string) {
    endDrag();
    setFolded((before) => {
      const after = new Set(before);
      if (after.has(id)) after.delete(id);
      else after.add(id);
      return after;
    });
  }

  /**
   * The Rejected heading: unfolds the column, or folds it again. Folding it
   * while the cursor is on it moves the cursor to Done, or the column would
   * stay drawn open under the cursor.
   */
  function toggleRejected() {
    endDrag();
    if (!rejectedDrawn) {
      setRejectedOpen(true);
      return;
    }
    setRejectedOpen(false);
    if (col === REJECTED) showColumn(REJECTED - 1);
  }

  return { folded, rejectedDrawn, toggleLane, toggleRejected };
}
