import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useMemo, useRef } from "react";

/**
 * How far from the pane's edges a button's point is kept. The `TAKE` transform in `book-pane.tsx`
 * moves the box by half its width and all of its height. A selection off the drawn page maps far
 * outside the pane, since the paginator expands the iframe, and the wrapper hides no overflow.
 */
export const INSET = 32;

/**
 * Clamps a button's point into the pane. The bottom is `box.height`, not `box.height - INSET`:
 * the book's button sits above its words, so a selection at the foot needs the room.
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
 * Whether a finger is down on a take button, from press to click. A selection can collapse during
 * a press, and that is not answered, or the button would vanish under the finger. A finger that
 * slides off ends in `pointerup` outside, which clears this and calls `onReleasedOutside`.
 */
export function usePressGuard(onReleasedOutside: () => void): {
  pressing: { current: boolean };
  press: PressHandlers;
} {
  const pressing = useRef(false);
  // A ref, so `press` keeps one identity and still calls the latest callback.
  const releasedRef = useRef(onReleasedOutside);
  useLayoutEffect(() => {
    releasedRef.current = onReleasedOutside;
  });

  const press = useMemo(
    () => ({
      // Stops focus and selection moving. Where the browser does not ask, `pressing` holds it.
      onPointerDown(event: ReactPointerEvent) {
        event.preventDefault();
        pressing.current = true;
      },
      onPointerCancel() {
        pressing.current = false;
      },
      // A lift outside the button is a press taken back. Left set, `pressing` would hold a
      // passage nothing selects and block page turns.
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
