import { useLayoutEffect, useRef } from "react";

export const STAGGER_MS = 22;
export const STAGGER_CAP = 6;
/** Must match the `k-enter` duration in app.css. */
export const ENTRANCE_MS = 240;

export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_CAP) * STAGGER_MS;
}

/**
 * Only the first non-empty list's keys enter, so a later row appears at once.
 * Until the entrance ends (ENTRANCE_MS after the longest stagger) a rerender keeps those keys.
 * After it none is admitted, so a remounted row does not arrive again.
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
