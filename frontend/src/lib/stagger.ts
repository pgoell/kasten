/**
 * The staggered entrance: a list's rows arrive one after another, not all at
 * once. The cap stops a long list from making its last rows wait.
 */

import { useLayoutEffect, useRef } from "react";

export const STAGGER_MS = 22;
export const STAGGER_CAP = 6;
/** How long one row's entrance plays, in ms. The `k-enter` animation in app.css is 240ms: keep the two equal. */
export const ENTRANCE_MS = 240;

/** The delay before row `index` arrives, in ms. Rows past the cap arrive with the cap's row. */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_CAP) * STAGGER_MS;
}

/**
 * Which keys get the entrance. Only the keys of the first non-empty list do,
 * so a row added later appears at once instead of sliding in, and a list that
 * re-renders does not replay its arrival.
 *
 * The entrance is over once the last of the first list has finished arriving,
 * ENTRANCE_MS after the longest stagger. Until then a rerender keeps the keys
 * admitted, as the queries settle while the rows are still arriving. After it,
 * no key is admitted, so a row edited into an input and back, or folded away
 * and unfolded, mounts again without arriving a second time.
 */
export function useEntrance(keys: readonly string[]): (key: string) => boolean {
  const first = useRef<ReadonlySet<string> | null>(null);
  // Set by the timer below. The timer triggers no render: the next one reads it.
  const over = useRef(false);
  if (first.current === null && keys.length > 0) first.current = new Set(keys);
  const started = first.current !== null;

  // Starts the clock at the first commit that drew the first list, and stops it
  // when the component goes. StrictMode mounts twice, so the clock is restarted.
  useLayoutEffect(() => {
    if (!started) return;
    const id = setTimeout(
      () => {
        over.current = true;
      },
      ENTRANCE_MS + STAGGER_CAP * STAGGER_MS,
    );
    return () => clearTimeout(id);
  }, [started]);

  return (key) => !over.current && (first.current?.has(key) ?? false);
}
