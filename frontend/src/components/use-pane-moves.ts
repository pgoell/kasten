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
   * Hand the keys back to the pane a prompt was opened over.
   *
   * The prompt gives the focus back to the element it took it from, and a write
   * that moves the row it was taken from leaves that element detached: the
   * browser then holds the focus on the body and the pane is deaf to every key
   * after it. This is the signal the pane already answers to when a key moves
   * to it, and it lands after the prompt's own handback.
   */
  const refocusPane = useCallback(
    () => setFocusSignal((previous) => previous + 1),
    [setFocusSignal],
  );

  /**
   * Decline a key where the reader can see it: the bar's one reading flashes.
   *
   * Answers null, which is what a refused reload hands back. A dozen keys and
   * one form of `:e` come through here, and a key that does nothing and says
   * nothing reads as a key that is broken.
   */
  const refuse = useCallback(() => {
    setRefused((previous) => previous + 1);
    return null;
  }, []);

  /**
   * Rearrange the panes, and hand the focus to whichever one we arrived at.
   *
   * Refused while the open note stands conflicted. Every one of these moves the
   * focused pane, which moves the note the autosave follows, and its cleanup
   * writes what is waiting to the note being left: the overwrite `saveFirst`
   * declines on every path that asks, arriving here with nobody asked.
   *
   * Every key that moves the focus comes through here. The one thing that moves
   * it without doing so is a click into another pane, which the pane layout
   * reports once the browser has already moved it, and which is deliberately
   * left alone below.
   *
   * `closeNote` reaches this after a save, by which point there is no conflict
   * left to catch it.
   *
   * It answers whether it moved. Sixteen callers ignore that, and `openPassage`
   * is the one that cannot: a passage armed for a key that was refused would
   * jump a reader that is already open.
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
   * Move to the pane in one direction on screen, staying put at the edge.
   *
   * The boxes are read before the layout is touched rather than inside the
   * update, which React is free to run more than once. Nothing happens with no
   * pane that way, so the focus is not raised for a key that moved nothing.
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
   * Trade places with the pane in one direction, standing still at the edge.
   *
   * The same question `focusToward` asks, answered off the same boxes, and the
   * answer swaps the two panes rather than moving the focus. Through `moveTo`
   * like every other change to the layout: React blurs an element it moves
   * between two parents, and the signal that call raises is what puts the
   * cursor back in the pane you are still in.
   *
   * Written first, which no move of the focus has to do. The autosave follows
   * the focused pane's note, and a swap leaves that note where it was, so
   * nothing flushes it: the hook's cleanup fires on a change of path and this
   * changes none. A swap between two splits builds the editor again from the
   * vault's copy, and without this the line typed in the last second is the
   * one the rebuild would drop.
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
