import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { BOOK, CFI, CHAPTERS, draw, rows, selects } from "./book-pane-fixture";
import { deferred, defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";

const { fetchBook, fetchNote, uploadAsset } = vi.hoisted(() => ({
  fetchBook: vi.fn(),
  fetchNote: vi.fn(),
  uploadAsset: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchBook, fetchNote, uploadAsset }));

// The factory is not optional. A bare `vi.mock(path)` automocks, and vitest's
// automock keeps the module body and replaces only its exports, so the real
// `customElements.define("foliate-view", View)` would run and the fake's own
// define would then throw. An empty factory stops the module evaluating at all.
vi.mock("foliate-js/view.js", () => ({}));

defineFoliateFake();

describe("the keys inside a book", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue({ path: BOOK, blob: new Blob(["a book"]) });
    fetchNote.mockResolvedValue("");
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  /** Draw a book and hand back the section document foliate reports. */
  async function opened() {
    const pane = draw();
    await waitFor(() => expect(lastView().started).toBe(true));
    // The seam every key and focus test fires on: a handler on the wrapper
    // alone never sees any of these, an event not crossing a document boundary.
    act(() => lastView().emitLoad());
    return pane;
  }

  function press(target: Document | Element, key: string, held: KeyboardEventInit = {}) {
    // Inside `act`, because `t` sets state on the pane and React flushes no
    // update made from a native listener outside one.
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...held }));
    });
  }

  it("turns the page forward on l", async () => {
    await opened();

    press(lastView().section, "l");

    expect(lastView().nexts).toBe(1);
  });

  it("turns the page back on h", async () => {
    await opened();

    press(lastView().section, "h");

    expect(lastView().prevs).toBe(1);
  });

  it("closes the reader on q", async () => {
    const pane = await opened();

    press(lastView().section, "q");

    expect(pane.commands.closeNote).toHaveBeenCalledTimes(1);
  });

  it("hands the book out on w", async () => {
    const pane = await opened();

    press(lastView().section, "w");

    expect(pane.commands.exportNote).toHaveBeenCalledTimes(1);
  });

  it("walks the panes on the terminal chord", async () => {
    // Tested here as well as in Chromium because this is the project that runs
    // on every push.
    const pane = await opened();

    press(lastView().section, "L", { ctrlKey: true, shiftKey: true });

    expect(pane.commands.paneRight).toHaveBeenCalledTimes(1);
  });

  it("leaves ctrl+h to the browser", async () => {
    // Chrome spends that chord on its history window, and a handler reading
    // `event.key` without the modifiers would steal it.
    await opened();

    press(lastView().section, "h", { ctrlKey: true });

    expect(lastView().prevs).toBe(0);
  });

  it("answers a key pressed on the pane itself", async () => {
    // The handler goes on the wrapper as well as on every section, and the
    // frame test only ever presses inside the iframe.
    const pane = await opened();

    press(pane.wrapper() as Element, "l");

    expect(lastView().nexts).toBe(1);
  });

  it("reports a click in the book as the pane taking the focus", async () => {
    // A click inside foliate's iframe fires no focus event on any ancestor, so
    // the route would go on believing another pane is focused and `q` would
    // close that pane's note.
    const pane = await opened();

    lastView().section.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(pane.onFocus).toHaveBeenCalled();
  });

  it("opens the contents on t, pressed inside the book", async () => {
    FakeView.toc = CHAPTERS;
    await opened();

    press(lastView().section, "t");

    expect(rows()).toEqual(["One", "Two"]);
  });

  it("opens them on a t pressed on the pane itself", async () => {
    FakeView.toc = CHAPTERS;
    const book = await opened();

    press(book.wrapper() as Element, "t");

    expect(rows()).toEqual(["One", "Two"]);
  });

  it("closes them on Escape, with the pane still answering its keys", async () => {
    FakeView.toc = CHAPTERS;
    const book = await opened();

    press(lastView().section, "t");
    press(screen.getByRole("dialog"), "Escape");

    expect(screen.queryByRole("dialog")).toBeNull();
    // Nowhere else to give the focus back to: both of foliate's shadow roots
    // are closed, so what held it before `t` was the `<foliate-view>` host.
    expect(document.activeElement).toBe(book.wrapper());
    // The only automated catch for an `onClose` that forgets to put the guard
    // ref back, which leaves the reader deaf to every key for good.
    press(book.wrapper() as Element, "l");
    expect(lastView().nexts).toBe(1);
    // The dependency trap: `onKeyDown` is in the view effect's dependencies, so
    // a handler closing over the contents state tears the book down and opens
    // it again on every `t`, losing the page.
    expect(FakeView.made).toHaveLength(1);
  });

  it("goes to the chapter Enter landed on", async () => {
    FakeView.toc = CHAPTERS;
    await opened();

    press(lastView().section, "t");
    const dialog = screen.getByRole("dialog");
    press(dialog, "j");
    press(dialog, "Enter");

    expect(lastView().gone).toEqual(["ch2.xhtml"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the contents on the chapter you are in", async () => {
    const chapters = [...CHAPTERS, { id: 2, label: "Three", href: "ch3.xhtml" }];
    FakeView.toc = chapters;
    await opened();
    // The identity story 2 rests on: `lastLocation.tocItem` is one of the very
    // objects `book.toc` holds, and the `id` on it is foliate's own, stamped by
    // `assignIDs` over that same array.
    lastView().lastLocation = { cfi: CFI, tocItem: chapters[2] };

    press(lastView().section, "t");

    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("Three");
  });

  it("answers none of its own keys while the contents are open", async () => {
    // The overlay renders inside the wrapper, whose listener is a native one,
    // while React delegates every event from the root container above it. A key
    // pressed in the overlay reaches the pane's handler first, so without the
    // guard `q` inside the contents closes the reader and `l` turns a page
    // behind the panel.
    FakeView.toc = CHAPTERS;
    const book = await opened();
    // Selected first, or `y` would do nothing here whatever the guard says.
    selects("A sentence worth keeping.");

    press(lastView().section, "t");
    const dialog = screen.getByRole("dialog");
    press(dialog, "l");
    press(dialog, "h");
    press(dialog, "q");
    press(dialog, "y");

    expect(lastView().nexts).toBe(0);
    expect(lastView().prevs).toBe(0);
    expect(book.commands.closeNote).not.toHaveBeenCalled();
    expect(book.onTake).not.toHaveBeenCalled();
  });

  it("says nothing at all about a book that is still opening", async () => {
    // `viewRef` holds the view from the moment the pane builds the element, and
    // `View.open` assigns `this.book` only after awaiting `makeBook`. A `t` in
    // that window must do nothing rather than report an empty contents over a
    // 30MB epub that is merely still unzipping.
    const open = deferred();
    FakeView.openWith = () => open.promise;
    FakeView.toc = CHAPTERS;
    const book = draw();
    await waitFor(() => expect(FakeView.made).toHaveLength(1));

    press(book.wrapper() as Element, "t");
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      open.resolve();
      await open.promise;
    });
    press(book.wrapper() as Element, "t");

    expect(rows()).toEqual(["One", "Two"]);
  });

  it("says so for a book whose publisher wrote no contents", async () => {
    await opened();

    press(lastView().section, "t");

    expect(rows()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("this book has no contents");
  });

  it("reports a tab into one of the book's links the same way", async () => {
    // Two listeners for two ways in, and neither covers the other: a paragraph
    // cannot hold focus, so a click fires no `focusin` at all.
    const pane = await opened();

    lastView().section.dispatchEvent(new Event("focusin", { bubbles: true }));

    expect(pane.onFocus).toHaveBeenCalled();
  });
});
