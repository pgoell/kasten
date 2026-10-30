import { type Dispatch, type SetStateAction, useCallback, useState } from "react";
import { paneRects } from "@/components/pane-layout";
import { type Direction, paneToward } from "@/lib/pane-direction";
import { focusPane, type Layout, swapPanes } from "@/lib/panes";

export type PaneMoves = ReturnType<typeof usePaneMoves>;

/**
 * Every key that rearranges the panes or moves the focus between them, and the
 * one refusal flag they all raise.
 */
export function usePaneMoves({
  setLayout,
  setFocusSignal,
  isConflicted,
  saveFirst,
  paneId,
}: {
  setLayout: Dispatch<SetStateAction<Layout>>;
  setFocusSignal: Dispatch<SetStateAction<number>>;
  isConflicted: () => boolean;
  saveFirst: () => Promise<boolean>;
  paneId: string;
}) {
  // Raised each time a key was refused, which flashes the status bar's reading.
  // A counter for the reason the two above are counters: pressing a refused key
  // twice is two refusals and both have to read as one. How long the flash
  // lasts is the bar's own business.
  const [refused, setRefused] = useState(0);

  /**
   * Hand keys back to the pane a prompt opened over. A write that moved its row can detach the
   * element the focus returns to, leaving the pane deaf to keys.
   */
  const refocusPane = useCallback(
    () => setFocusSignal((previous) => previous + 1),
    [setFocusSignal],
  );

  /** Flash the bar's reading to decline a key the reader can see. Answers null, as a refused reload does. */
  const refuse = useCallback(() => {
    setRefused((previous) => previous + 1);
    return null;
  }, []);

  /**
   * Rearrange the panes and focus the one arrived at. Refused while the open note is conflicted,
   * since moving focus moves the autosave's note. Answers whether it moved, which `openPassage` needs.
   */
  const moveTo = useCallback(
    (update: (previous: Layout) => Layout) => {
      if (isConflicted()) {
        refuse();
        return false;
      }

      setLayout(update);
      setFocusSignal((previous) => previous + 1);
      return true;
    },
    [isConflicted, refuse, setLayout, setFocusSignal],
  );

  /**
   * Move focus to the pane one way on screen, staying put at the edge. The boxes are read before
   * the layout update, which React may run twice.
   */
  const focusToward = useCallback(
    (dir: Direction) => {
      const target = paneToward(paneRects(), paneId, dir);
      if (target === null) return;
      moveTo((previous) => focusPane(previous, target));
    },
    [moveTo, paneId],
  );

  /**
   * Trade places with the pane one way, standing still at the edge. Goes through `moveTo`, and writes
   * the note first: a swap rebuilds the editor from the vault's copy and would drop a line typed in
   * the last second.
   */
  const swapToward = useCallback(
    async (dir: Direction) => {
      const target = paneToward(paneRects(), paneId, dir);
      if (target === null) return;
      if (!(await saveFirst())) {
        refuse();
        return;
      }
      moveTo((previous) => swapPanes(previous, target));
    },
    [moveTo, refuse, saveFirst, paneId],
  );

  return { refused, refuse, refocusPane, moveTo, focusToward, swapToward };
}
