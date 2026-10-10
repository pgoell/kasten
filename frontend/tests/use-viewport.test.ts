/**
 * The hook against a `matchMedia` the test owns.
 *
 * jsdom lays nothing out and has no `matchMedia` at all, so each query gets a
 * list whose answer the test sets and whose change event the test fires.
 */

import { act, renderHook } from "@testing-library/react";
import { useViewport } from "@/lib/use-viewport";

/** The two queries, spelled here so a change to either fails loudly. */
const NARROW = "(width < 48rem)";
const COARSE = "(pointer: coarse)";

/** One list per query, as a browser keeps one answer per query. */
function stubMatchMedia(initial: Record<string, boolean>) {
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
    queries: () => [...lists.keys()],
    listening: () => [...lists.values()].reduce((sum, list) => sum + list.listeners.size, 0),
    set: (query: string, matches: boolean) =>
      act(() => {
        const list = lists.get(query);
        if (!list) throw new Error(`nothing asked for ${query}`);
        list.matches = matches;
        for (const listener of list.listeners) listener();
      }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useViewport", () => {
  it("answers a wide window with a mouse", () => {
    stubMatchMedia({});
    const { result } = renderHook(() => useViewport());

    expect(result.current).toEqual({ narrow: false, coarse: false });
  });

  it("answers a phone", () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const { result } = renderHook(() => useViewport());

    expect(result.current).toEqual({ narrow: true, coarse: true });
  });

  it("asks the two queries and no other", () => {
    const media = stubMatchMedia({});
    renderHook(() => useViewport());

    expect(media.queries().sort()).toEqual([COARSE, NARROW].sort());
  });

  it("follows the window across the breakpoint, both ways", () => {
    const media = stubMatchMedia({});
    const { result } = renderHook(() => useViewport());

    media.set(NARROW, true);
    expect(result.current).toEqual({ narrow: true, coarse: false });

    media.set(NARROW, false);
    expect(result.current).toEqual({ narrow: false, coarse: false });
  });

  it("follows the pointer without moving the width", () => {
    const media = stubMatchMedia({ [NARROW]: true });
    const { result } = renderHook(() => useViewport());

    media.set(COARSE, true);
    expect(result.current).toEqual({ narrow: true, coarse: true });
  });

  it("stops listening when it unmounts", () => {
    const media = stubMatchMedia({});
    const { unmount } = renderHook(() => useViewport());
    expect(media.listening()).toBe(2);

    unmount();
    expect(media.listening()).toBe(0);
  });
});
