import { useCallback, useSyncExternalStore } from "react";

/**
 * Below Tailwind's `md`, written as Tailwind 4 writes it, so it agrees with `md:` at any root
 * font size.
 */
export const NARROW = "(width < 48rem)";

/** A finger rather than a mouse, judged by the primary pointer only. */
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
 * Two facts, not one answer to "is this a phone?": a narrow desktop window wants the small
 * layout and keeps its keyboard, and a tablet is wide and has none.
 */
export function useViewport(): {
  /** The window is narrower than Tailwind's `md` breakpoint. */
  narrow: boolean;
  /** The primary pointer is coarse, which is a touch screen. */
  coarse: boolean;
} {
  return { narrow: useMediaQuery(NARROW), coarse: useMediaQuery(COARSE) };
}
