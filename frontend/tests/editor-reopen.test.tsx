import { EditorView } from "@codemirror/view";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { toggleVim } from "@/lib/vim-setting";
import { deleteCurrentLine } from "./editor-fixture";

describe("Editor reopening a note where it was left (#495)", () => {
  const DOC = "one\ntwo\nthree\nfour";
  // Inside `three`, so the line and the column both have to come back.
  const IN_THREE = "one\ntwo\nth".length;
  // The store's key and shape, written out rather than imported: these tests
  // hold the editor to what lands in the browser, not to the module's API.
  const KEY = "kasten.positions.1";

  function viewIn(container: HTMLElement): EditorView {
    return EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    ) as EditorView;
  }

  /** Open the note, put the cursor and the scroll somewhere, and close it. */
  function leave(cursor: number, top = 0) {
    // On screen, or the scroll read off it would not count.
    const height = boxHigh(400);
    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
    const view = viewIn(container);
    act(() => view.dispatch({ selection: { anchor: cursor } }));
    view.scrollDOM.scrollTop = top;
    fireEvent.scroll(view.scrollDOM);
    unmount();
    height.mockRestore();
  }

  /**
   * jsdom lays nothing out, so every scroller is 0 high, which is what a pane
   * hidden behind a zoom is in a browser. A test of a pane on screen says so.
   */
  function boxHigh(height: number) {
    return vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(height);
  }

  /**
   * jsdom resizes nothing, so the observers it hands out never report. These
   * keep what each watches, and the returned function tells one box's
   * observer it changed size, as a browser would on a pane hidden or shown.
   */
  function watchResizes() {
    const watched = new Map<Element, () => void>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element) {
          watched.set(target, () => this.callback([], this as unknown as ResizeObserver));
        }
        unobserve() {}
        disconnect() {}
      },
    );
    return (target: Element) => act(() => watched.get(target)?.());
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it.each([
    ["on", false],
    ["off", true],
  ])("editor: A6 a note reopens at its saved cursor with vim %s", (vim, toggle) => {
    if (toggle) act(() => toggleVim());
    leave(IN_THREE);

    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);

    expect(viewIn(container).state.selection.main.head).toBe(IN_THREE);
    // Vim's own cursor is the one its keys act on, so ask it where it is.
    if (vim === "on") expect(deleteCurrentLine(container)).toBe("onetwofour");
    unmount();
  });

  it.each([
    ["on", false],
    ["off", true],
  ])("editor: A6 a note reopens at its saved scroll with vim %s", (_, toggle) => {
    if (toggle) act(() => toggleVim());
    leave(0, 120);
    boxHigh(400);

    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);

    expect(viewIn(container).scrollDOM.scrollTop).toBe(120);
    unmount();
  });

  it("editor: A6 a pane hidden at mount gets its saved scroll back when it shows", async () => {
    localStorage.setItem(KEY, JSON.stringify([["a.md", { anchor: 0, head: 0, top: 120 }]]));
    const height = boxHigh(0);

    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
    const view = viewIn(container);
    // A hidden scroller in a browser keeps no offset; jsdom keeps any number,
    // so an editor that wrote it now would read back 120 here.
    expect(view.scrollDOM.scrollTop).toBe(0);

    // Shown: a height, and a place on the page, which is how CodeMirror tells
    // an editor on screen from one that is not.
    height.mockReturnValue(400);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 600, 400),
    );
    act(() => view.requestMeasure());

    await vi.waitFor(() => expect(view.scrollDOM.scrollTop).toBe(120));
    unmount();
  });

  it("editor: A6 a pane hidden at mount keeps its saved scroll when it closes unseen", () => {
    localStorage.setItem(KEY, JSON.stringify([["a.md", { anchor: 0, head: 0, top: 120 }]]));
    boxHigh(0);

    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
    const view = viewIn(container);
    act(() => view.dispatch({ selection: { anchor: IN_THREE } }));
    // What a hidden scroller reports, if anything makes it report.
    view.scrollDOM.scrollTop = 0;
    fireEvent.scroll(view.scrollDOM);
    unmount();

    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual([
      ["a.md", { anchor: IN_THREE, head: IN_THREE, top: 120 }],
    ]);
  });

  it("editor: A6 a pane hidden by a zoom after it showed keeps its saved scroll", () => {
    const height = boxHigh(400);
    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
    const view = viewIn(container);
    view.scrollDOM.scrollTop = 120;
    fireEvent.scroll(view.scrollDOM);

    // Zoomed out of sight: no height, and the offset a browser reports then.
    height.mockReturnValue(0);
    view.scrollDOM.scrollTop = 0;
    fireEvent.scroll(view.scrollDOM);
    unmount();

    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual([
      ["a.md", { anchor: 0, head: 0, top: 120 }],
    ]);
  });

  it.each([
    ["on", false],
    ["off", true],
  ])(
    "editor: A5 a pane zoomed out of sight comes back at its scroll on the unzoom, vim %s",
    (_, toggle) => {
      if (toggle) act(() => toggleVim());
      const resized = watchResizes();
      const height = boxHigh(400);
      const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
      const view = viewIn(container);
      view.scrollDOM.scrollTop = 120;
      fireEvent.scroll(view.scrollDOM);

      // Zoomed out of sight: no height, and the offset a browser drops then.
      height.mockReturnValue(0);
      view.scrollDOM.scrollTop = 0;
      fireEvent.scroll(view.scrollDOM);
      resized(view.scrollDOM);
      // Back at the size it left, which CodeMirror sees as no change at all.
      height.mockReturnValue(400);
      resized(view.scrollDOM);

      expect(view.scrollDOM.scrollTop).toBe(120);
      unmount();
    },
  );

  it("editor: A5 a scroll the unzoomed pane reports before its observer does keeps its place", () => {
    const resized = watchResizes();
    const height = boxHigh(400);
    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
    const view = viewIn(container);
    view.scrollDOM.scrollTop = 120;
    fireEvent.scroll(view.scrollDOM);

    height.mockReturnValue(0);
    view.scrollDOM.scrollTop = 0;
    resized(view.scrollDOM);
    // Shown again, and a browser runs the scroll event ahead of the observer,
    // with the offset it dropped while the pane was hidden.
    height.mockReturnValue(400);
    fireEvent.scroll(view.scrollDOM);
    resized(view.scrollDOM);

    expect(view.scrollDOM.scrollTop).toBe(120);
    unmount();
  });

  it("editor: A7 a pane a narrow window switches away from and back comes back at its scroll each time", () => {
    const resized = watchResizes();
    const height = boxHigh(400);
    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
    const view = viewIn(container);
    function away() {
      height.mockReturnValue(0);
      view.scrollDOM.scrollTop = 0;
      fireEvent.scroll(view.scrollDOM);
      resized(view.scrollDOM);
    }
    function back() {
      height.mockReturnValue(400);
      resized(view.scrollDOM);
    }
    view.scrollDOM.scrollTop = 120;
    fireEvent.scroll(view.scrollDOM);

    away();
    back();
    expect(view.scrollDOM.scrollTop).toBe(120);

    // Read on from there, so the second return is to the new place.
    view.scrollDOM.scrollTop = 200;
    fireEvent.scroll(view.scrollDOM);
    away();
    back();
    expect(view.scrollDOM.scrollTop).toBe(200);
    unmount();
  });

  it("editor: I6 the zoomed pane keeps its own scroll across the zoom and the unzoom", () => {
    const resized = watchResizes();
    const height = boxHigh(400);
    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
    const view = viewIn(container);
    view.scrollDOM.scrollTop = 120;
    fireEvent.scroll(view.scrollDOM);

    // Zoomed: the whole window, read further down while it has it.
    height.mockReturnValue(800);
    resized(view.scrollDOM);
    view.scrollDOM.scrollTop = 300;
    fireEvent.scroll(view.scrollDOM);
    // Unzoomed: smaller again, but never without a height.
    height.mockReturnValue(400);
    resized(view.scrollDOM);
    expect(view.scrollDOM.scrollTop).toBe(300);
    unmount();

    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual([
      ["a.md", { anchor: 0, head: 0, top: 300 }],
    ]);
  });

  it("editor: A6 closing a note whose cursor and scroll did not move writes nothing", () => {
    localStorage.setItem(KEY, JSON.stringify([["a.md", { anchor: 0, head: 0, top: 0 }]]));
    const write = vi.spyOn(Storage.prototype, "setItem");

    const { unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
    fireEvent(window, new Event("pagehide"));
    unmount();

    expect(write).not.toHaveBeenCalled();
  });

  it("editor: A6 a line asked for beats the saved cursor, which holds without one", () => {
    leave(IN_THREE);

    const plain = render(<Editor initialDoc={DOC} path="a.md" />);
    expect(viewIn(plain.container).state.selection.main.head).toBe(IN_THREE);
    plain.unmount();

    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" startLine={4} />);
    expect(deleteCurrentLine(container)).toBe("onetwothree");
    unmount();
  });

  it("editor: A6 a saved cursor past the end of a note edited elsewhere clamps to its length", () => {
    localStorage.setItem(KEY, JSON.stringify([["a.md", { anchor: 500, head: 500, top: 0 }]]));

    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);

    expect(viewIn(container).state.selection.main.head).toBe(DOC.length);
    unmount();
  });

  it("editor: A6 the page going away stores the note's path and three numbers, no text", () => {
    const { container, unmount } = render(<Editor initialDoc={DOC} path="a.md" />);
    act(() => viewIn(container).dispatch({ selection: { anchor: IN_THREE } }));

    fireEvent(window, new Event("pagehide"));

    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual([
      ["a.md", { anchor: IN_THREE, head: IN_THREE, top: 0 }],
    ]);
    unmount();
  });

  it("editor: A6 an editor holding no note leaves the store as the last note left it", () => {
    leave(IN_THREE);
    const stored = localStorage.getItem(KEY);
    expect(stored).not.toBeNull();

    const { container, unmount } = render(<Editor initialDoc={DOC} />);
    act(() => viewIn(container).dispatch({ selection: { anchor: 2 } }));
    fireEvent(window, new Event("pagehide"));
    unmount();

    expect(localStorage.getItem(KEY)).toBe(stored);
  });
});
