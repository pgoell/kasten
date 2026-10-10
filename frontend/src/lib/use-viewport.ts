import { useCallback, useSyncExternalStore } from "react";

/**
 * Below Tailwind's `md`, spelled the way Tailwind 4 spells the breakpoint, so
 * this and an `md:` class cannot disagree at a fractional width or a root font
 * size that is not 16px. 48rem is 768px at the default.
 */
export const NARROW = "(width < 48rem)";

/** A finger rather than a mouse. The primary pointer only: a laptop with a touch screen stays fine. */
export const COARSE = "(pointer: coarse)";

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (changed: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", changed);
      return () => list.removeEventListener("change", changed);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/**
 * The one answer to "is this a phone?", as two facts a caller picks between.
 *
 * Kept apart because they are not one question: a narrow desktop window wants
 * the small layout and keeps its keyboard, and a tablet is wide and has none.
 */
export function useViewport(): {
  /** The window is narrower than Tailwind's `md` breakpoint. */
  narrow: boolean;
  /** The primary pointer is coarse, which is a touch screen. */
  coarse: boolean;
} {
  return { narrow: useMediaQuery(NARROW), coarse: useMediaQuery(COARSE) };
}
