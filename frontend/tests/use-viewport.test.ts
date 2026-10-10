/**
 * The hook against a `matchMedia` the test owns.
 *
 * jsdom lays nothing out and has no `matchMedia` at all, so each query gets a
 * list whose answer the test sets and whose change event the test fires.
 */

import { renderHook } from "@testing-library/react";
import { useViewport } from "@/lib/use-viewport";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useViewport", () => {
  it("answers a wide window with a mouse where no test says otherwise", () => {
    // The default out of `tests/setup.ts`, which every other test file gets.
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
