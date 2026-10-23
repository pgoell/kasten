import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import type { FoliateView } from "@/lib/foliate-view";
import { useBookKeys } from "@/lib/use-book-keys";
import type { BookTake } from "@/lib/use-book-take";
import { useBookTurns } from "@/lib/use-book-turns";
import { hostLeader } from "@/lib/which-key";
import { stubCommands } from "./stub-commands";

/** A flowing book's view: a renderer that records each step, a page turn that counts. */
function flowing(contents: { doc: Document }[] = []) {
  const renderer = {
    next: vi.fn(),
    prev: vi.fn(),
    setAttribute: vi.fn(),
    getContents: () => contents,
  };
  return {
    view: {
      isFixedLayout: false,
      next: vi.fn(),
      prev: vi.fn(),
      renderer,
    } as unknown as FoliateView,
    renderer,
  };
}

/** The turns hook and the keys hook built on it, mounted over a wrapper and a view. */
function mount(view: FoliateView) {
  const wrapper = document.createElement("div");
  wrapper.tabIndex = -1;
  document.body.append(wrapper);
  const wrapperRef = { current: wrapper } as RefObject<HTMLDivElement | null>;
  const viewRef = { current: view } as RefObject<FoliateView | null>;
  const commands = stubCommands();
  const contentsOpen = { current: false } as RefObject<boolean>;
  const { unmount } = renderHook(() => {
    const turns = useBookTurns({
      wrapper: wrapperRef,
      viewRef,
      ready: { current: true } as RefObject<boolean>,
      coarse: false,
      holding: () => false,
    });
    return useBookKeys({
      wrapper: wrapperRef,
      viewRef,
      commands,
      contentsOpen,
      turn: turns.turn,
      scroll: turns.scroll,
      take: vi.fn() as unknown as BookTake["take"],
      openContents: vi.fn(),
    });
  });
  const press = (key: string, held: KeyboardEventInit = {}) =>
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...held }));
  return { wrapper, commands, press, unmount };
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.removeItem("kasten.vim");
});

describe("j and k in the book", () => {
  it("scrolls a flowing book down by three reading lines on j", () => {
    const { view, renderer } = flowing();
    const { press, unmount } = mount(view);

    press("j");

    expect(renderer.next).toHaveBeenCalledWith(91);
    expect(renderer.prev).not.toHaveBeenCalled();
    unmount();
  });

  it("scrolls a flowing book up by three reading lines on k", () => {
    const { view, renderer } = flowing();
    const { press, unmount } = mount(view);

    press("k");

    expect(renderer.prev).toHaveBeenCalledWith(91);
    expect(renderer.next).not.toHaveBeenCalled();
    unmount();
  });

  it("turns the page of a fixed-layout book on j and k, and does not scroll it", () => {
    const { view, renderer } = flowing();
    view.isFixedLayout = true;
    const { press, unmount } = mount(view);

    press("j");
    press("k");

    expect.soft(view.next).toHaveBeenCalledTimes(1);
    expect.soft(view.prev).toHaveBeenCalledTimes(1);
    expect.soft(renderer.next).not.toHaveBeenCalled();
    expect.soft(renderer.prev).not.toHaveBeenCalled();
    unmount();
  });

  it("leaves j with a modifier held to the browser, as the other bare keys do", () => {
    const { view, renderer } = flowing();
    const { press, unmount } = mount(view);

    press("j", { ctrlKey: true });

    expect(renderer.next).not.toHaveBeenCalled();
    unmount();
  });
});

describe("Escape in the book", () => {
  it("clears the selection in every document on screen and focuses the pane", () => {
    const first = document.implementation.createHTMLDocument("one");
    const second = document.implementation.createHTMLDocument("two");
    const cleared = vi.fn();
    for (const doc of [first, second])
      doc.getSelection = () => ({ removeAllRanges: cleared }) as unknown as Selection;
    const { view } = flowing([{ doc: first }, { doc: second }]);
    const { wrapper, press, unmount } = mount(view);
    // Focus starts on something else, so the move to the pane is what the test sees.
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();

    press("Escape");

    // Soft, so the focus is still checked when the selection is not cleared.
    expect.soft(cleared).toHaveBeenCalledTimes(2);
    expect.soft(document.activeElement).toBe(wrapper);
    unmount();
  });
});

describe("Space in the book", () => {
  it("opens the leader from the pane with vim mode on", () => {
    localStorage.setItem("kasten.vim", "on");
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { view } = flowing();
    const { press, unmount } = mount(view);

    press(" ");

    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    off();
  });

  it("opens the leader from the pane with vim mode off", () => {
    localStorage.setItem("kasten.vim", "off");
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { view } = flowing();
    const { press, unmount } = mount(view);

    press(" ");

    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    off();
  });
});
