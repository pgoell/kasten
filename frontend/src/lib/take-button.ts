import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useMemo, useRef } from "react";

/**
 * How far from the pane's edges the button's own point is kept.
 *
 * It has to cover **half the button's width and the whole of its height**,
 * because the transform on `TAKE` in `book-pane.tsx` moves the box by both.
 * Measured against that class list: 24px tall and about 40px wide, so this is
 * comfortably over the larger of 24 and 20. A selection off the drawn page maps
 * well outside the pane, the paginator having expanded the iframe to the whole
 * columnised chapter, and the wrapper hides no overflow of its own.
 */
export const INSET = 32;

/**
 * The point a button goes to, kept where its box is still in the pane.
 *
 * The bottom is `box.height` and not `box.height - INSET`: the book's button
 * sits above its words, so a selection at the foot of the pane is the one that
 * needs the room. The top and the sides keep `INSET`.
 */
export function clampInside(
  x: number,
  y: number,
  box: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, INSET), box.width - INSET),
    y: Math.min(Math.max(y, INSET), box.height),
  };
}

/** The handlers a button spreads on itself to hold a press, as `usePressGuard` returns them. */
export interface PressHandlers {
  onPointerDown(event: ReactPointerEvent): void;
  onPointerCancel(): void;
  onPointerUp(event: ReactPointerEvent<HTMLButtonElement>): void;
}

/**
 * Whether a finger is down on a take button, between its press and its click.
 *
 * The selection can go while a finger is down: a phone may put it away for a
 * tap that lands outside the frame, and that `selectionchange` arrives before
 * the `click`. Answering it would forget the passage and take the button out
 * from under the finger, so a collapse during a press is not answered at all.
 *
 * A finger slid off the button ends in no click and no `pointercancel`, so the
 * button's `pointerup` clears this when it lands outside the button, and
 * `onReleasedOutside` is asked what the collapse skipped.
 *
 * `pressing` is a ref because the listeners that read it are built once with
 * their pane. `press` keeps one identity for the life of the pane.
 */
export function usePressGuard(onReleasedOutside: () => void): {
  pressing: { current: boolean };
  press: PressHandlers;
} {
  const pressing = useRef(false);
  // Read through a ref, so `press` can keep the identity it is memoised with.
  // Written in a layout effect, the way the panes write their callbacks.
  const releasedRef = useRef(onReleasedOutside);
  useLayoutEffect(() => {
    releasedRef.current = onReleasedOutside;
  });

  const press = useMemo(
    () => ({
      // Refused so the press moves neither the focus nor the selection, where
      // the browser asks. Where it does not ask, `pressing` holds the passage
      // through the collapse.
      onPointerDown(event: ReactPointerEvent) {
        event.preventDefault();
        pressing.current = true;
      },
      onPointerCancel() {
        pressing.current = false;
      },
      // The pointer is the button's for the whole press, so a lift anywhere
      // arrives here, and one outside is a press taken back. Left set, the flag
      // would hold a passage nothing selects and keep the edges of the page from
      // turning it.
      onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
        const box = event.currentTarget.getBoundingClientRect();
        const inside =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom;
        if (inside) return;
        pressing.current = false;
        releasedRef.current();
      },
    }),
    [],
  );

  return { pressing, press };
}
