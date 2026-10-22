/**
 * The staggered entrance: a list's rows arrive one after another, not all at
 * once. The cap stops a long list from making its last rows wait.
 */

import { useRef } from "react";

export const STAGGER_MS = 22;
export const STAGGER_CAP = 6;

/** The delay before row `index` arrives, in ms. Rows past the cap arrive with the cap's row. */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_CAP) * STAGGER_MS;
}

/**
 * Which keys get the entrance. Only the keys of the first non-empty list do,
 * so a row added later appears at once instead of sliding in, and a list that
 * re-renders does not replay its arrival.
 */
export function useEntrance(keys: readonly string[]): (key: string) => boolean {
  const first = useRef<ReadonlySet<string> | null>(null);
  if (first.current === null && keys.length > 0) first.current = new Set(keys);
  return (key) => first.current?.has(key) ?? false;
}
