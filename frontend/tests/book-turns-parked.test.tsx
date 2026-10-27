import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import type { FoliateView } from "@/lib/book/foliate-view";
import { useBookTurns } from "@/lib/book/use-book-turns";

describe("a scroll key pressed before the book is ready", () => {
  it("replays as one scroll step on a flowing book once it is ready", () => {
    const renderer = { next: vi.fn(), prev: vi.fn() };
    const view = {
      isFixedLayout: false,
      next: vi.fn(),
      prev: vi.fn(),
      renderer,
    } as unknown as FoliateView;
    const ready = { current: false };
    const { result } = renderHook(() =>
      useBookTurns({
        wrapper: { current: document.createElement("div") } as RefObject<HTMLDivElement | null>,
        viewRef: { current: view } as RefObject<FoliateView | null>,
        ready: ready as RefObject<boolean>,
        coarse: false,
        holding: () => false,
      }),
    );

    result.current.scroll("down");
    ready.current = true;
    result.current.release(view, false);

    // Soft, so the page turn is still counted when the scroll is missing.
    expect.soft(renderer.next).toHaveBeenCalledTimes(1);
    expect.soft(renderer.next).toHaveBeenCalledWith(91);
    expect.soft(view.next).not.toHaveBeenCalled();
  });
});
