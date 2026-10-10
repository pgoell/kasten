/**
 * A `matchMedia` a test owns, for the tests that want a phone.
 *
 * `tests/setup.ts` already answers every query with no, which is a wide window
 * and a mouse. This replaces that for one test: each query gets a list whose
 * answer the test sets and whose change event the test fires. It goes in through
 * `vi.stubGlobal`, so `vi.unstubAllGlobals()` puts the default back.
 */

import { act } from "@testing-library/react";

/** The two queries `useViewport` asks, spelled here so a change to either fails loudly. */
export const NARROW = "(width < 48rem)";
export const COARSE = "(pointer: coarse)";

/** One list per query, as a browser keeps one answer per query. */
export function stubMatchMedia(initial: Record<string, boolean> = {}) {
  const lists = new Map<string, { matches: boolean; listeners: Set<() => void> }>();

  vi.stubGlobal("matchMedia", (query: string) => {
    let list = lists.get(query);
    if (!list) {
      list = { matches: initial[query] ?? false, listeners: new Set() };
      lists.set(query, list);
    }
    const held = list;
    return {
      media: query,
      get matches() {
        return held.matches;
      },
      addEventListener: (_type: "change", listener: () => void) => held.listeners.add(listener),
      removeEventListener: (_type: "change", listener: () => void) =>
        held.listeners.delete(listener),
    };
  });

  return {
    /** Every query asked so far. */
    queries: () => [...lists.keys()],
    /** How many change listeners are attached, over every query. */
    listening: () => [...lists.values()].reduce((sum, list) => sum + list.listeners.size, 0),
    /** Change a query's answer and fire its change event, inside `act`. */
    set: (query: string, matches: boolean) =>
      act(() => {
        const list = lists.get(query);
        if (!list) throw new Error(`nothing asked for ${query}`);
        list.matches = matches;
        for (const listener of list.listeners) listener();
      }),
  };
}
