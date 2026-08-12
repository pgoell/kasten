import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { BookPane } from "@/components/book-pane";
import { bookPath } from "@/lib/note-path";
import { deferred, defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";
import { stubCommands } from "./stub-commands";

const { fetchBook, fetchNote } = vi.hoisted(() => ({ fetchBook: vi.fn(), fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchBook, fetchNote }));

// The factory is not optional. A bare `vi.mock(path)` automocks, and vitest's
// automock keeps the module body and replaces only its exports, so the real
// `customElements.define("foliate-view", View)` would run and the fake's own
// define would then throw. An empty factory stops the module evaluating at all.
vi.mock("foliate-js/view.js", () => ({}));

const NOTE = "20 Literature/DDIA.md";
const BOOK = "20 Literature/DDIA.epub";

/** What the One background reads as, so the styling case has a value to find. */
const BACKGROUND = "#282c34";

/** A place in a book, as the note's block holds it. */
const CFI = "epubcfi(/6/14!/4/2/2/1:0)";

/**
 * A two entry contents, carrying the ids foliate stamps on the real thing.
 *
 * Written here rather than left off: `assignIDs` runs inside `TOCProgress.init`
 * (`progress.js:2-10`), which only the real `View.open` calls, and a toc with no
 * ids leaves every row and the current item at undefined, which matches the
 * first row whatever the book is showing.
 */
const CHAPTERS = [
  { id: 0, label: "One", href: "ch1.xhtml" },
  { id: 1, label: "Two", href: "ch2.xhtml" },
];

/** The literature note, with `reading:` set or with nothing in the block. */
function noteWith(cfi?: string): string {
  return [
    "---",
    "id: one",
    ...(cfi === undefined ? [] : [`reading: ${cfi}`]),
    "---",
    "# DDIA",
  ].join("\n");
}

defineFoliateFake();

function draw(props: { note?: string; paths?: string[]; seed?: Blob } = {}) {
  const commands = stubCommands();
  const onFocus = vi.fn();
  const onMoved = vi.fn();
  const onLeaving = vi.fn();
  const client = new QueryClient({
    // Never stale, so nothing refetches behind a test that already has its blob.
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  // Seeded so the very first render already has bytes. The effect returns early
  // while the query is pending, and StrictMode double-invokes on mount only, so
  // without this the double mount happens before there is a book to open.
  if (props.seed) client.setQueryData(["book", bookPath(props.note ?? NOTE)], props.seed);
  const tree = (focusSignal: number) => (
    <QueryClientProvider client={client}>
      <BookPane
        note={props.note ?? NOTE}
        paths={props.paths}
        commands={commands}
        focusSignal={focusSignal}
        onFocus={onFocus}
        onMoved={onMoved}
        onLeaving={onLeaving}
      />
    </QueryClientProvider>
  );

  const view = render(props.seed ? <StrictMode>{tree(0)}</StrictMode> : tree(0));
  return {
    ...view,
    commands,
    onFocus,
    onMoved,
    onLeaving,
    /** Hand the pane another focus signal, the way the route does. */
    signal: (focusSignal: number) => view.rerender(tree(focusSignal)),
    /** The pane's own wrapper, which is what a signal puts the cursor on. */
    wrapper: () => view.container.querySelector("[data-book-pane]"),
  };
}

/** The panel the pane draws instead of a book, or null while it is reading one. */
function panel(): HTMLElement | null {
  return screen.queryByRole("alert");
}

/** What the line at the bottom of the pane says, which is nothing until it knows. */
function progress(): string {
  return document.querySelector("[data-book-pane] footer")?.textContent ?? "";
}

/** What the contents are showing, and nothing at all while they are shut. */
function rows(): (string | null)[] {
  return screen.queryAllByRole("option").map((row) => row.textContent);
}

describe("BookPane", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue(new Blob(["a book"]));
    // A string and not undefined: the pane reads a field off what this answers,
    // and `mockResolvedValue(undefined)` is a default too, one that draws the
    // error panel over every case in this file.
    fetchNote.mockResolvedValue("");
    document.documentElement.style.setProperty("--color-one-bg", BACKGROUND);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("draws the book once the bytes arrive", async () => {
    draw();

    await waitFor(() => expect(lastView().started).toBe(true));
    expect(panel()).toBeNull();
  });

  it("opens the book where the note says the reader stopped", async () => {
    fetchNote.mockResolvedValue(noteWith(CFI));

    draw();

    await waitFor(() => expect(lastView().started).toBe(true));
    expect(lastView().inits[0]).toEqual({ lastLocation: CFI });
  });

  it("opens a book whose note names no place at the front", async () => {
    fetchNote.mockResolvedValue(noteWith());

    draw();

    await waitFor(() => expect(lastView().started).toBe(true));
    // The key present and undefined, rather than the value alone: `view.init({})`
    // carries no `lastLocation` either, so asserting undefined would pass before
    // the pane read anything at all.
    const [first] = lastView().inits;
    expect(first).toHaveProperty("lastLocation");
    expect(first).toEqual({ lastLocation: undefined });
  });

  it("still draws the book when its note cannot be read", async () => {
    // A book whose note the vault will not answer for is still a book you can
    // read, so the failure arm answers with no text rather than the panel.
    fetchNote.mockRejectedValue(new Error("GET /api/files/20 Literature/DDIA.md failed with 404"));

    draw();

    // That the note was asked for at all, for the reason above: nothing calls
    // it before this slice, so a case looking only at the panel starts green.
    await waitFor(() => expect(fetchNote).toHaveBeenCalledWith(NOTE));
    await waitFor(() => expect(lastView().started).toBe(true));
    expect(panel()).toBeNull();
  });

  it("builds nothing over a view the pane has already closed", async () => {
    // A cleanup nulls `lastLocation` in the real library too (`view.js:304`),
    // so without the check between the two the fallback navigates a closed view.
    FakeView.navigatesNowhere = true;
    const init = deferred();
    FakeView.initWith = () => init.promise;
    const { unmount } = draw();

    await waitFor(() => expect(lastView().inits).toHaveLength(1));
    unmount();
    await act(async () => {
      init.resolve();
      await init.promise;
    });

    expect(lastView().inits).toHaveLength(1);
  });

  it("says which book it wanted when the vault has none", async () => {
    fetchBook.mockRejectedValue(new Error("GET /api/assets failed with 404"));

    draw();

    await waitFor(() => expect(panel()).toHaveTextContent(BOOK));
  });

  it("says so for a book of no bytes", async () => {
    // foliate throws `NotFoundError` on `!file.size`, which reads as a broken
    // library rather than as an empty file.
    fetchBook.mockResolvedValue(new Blob([]));

    draw();

    await waitFor(() => expect(panel()).toHaveTextContent(BOOK));
  });

  it("says so when the book cannot be opened", async () => {
    FakeView.openWith = () => Promise.reject(new Error("not an epub"));

    draw();

    await waitFor(() => expect(panel()).toHaveTextContent(BOOK));
  });

  it("says so when the first navigation fails and nothing loaded", async () => {
    // Both halves, because a throw on its own is a stale bookmark now: the
    // panel is drawn only where the retry below fails too, which is a book
    // foliate opened and cannot render a page of.
    FakeView.navigatesNowhere = true;
    FakeView.initWith = () => Promise.reject(new Error("nowhere to go"));

    draw();

    await waitFor(() => expect(panel()).toHaveTextContent(BOOK));
  });

  it("goes to the front of the book when the saved place loaded nothing", async () => {
    // A cfi naming a spine item this book has not got: `resolveCFI` answers
    // `{ index: -1 }`, `init` takes that and the renderer refuses the index, so
    // the pane draws a blank page and every key looks broken.
    FakeView.navigatesNowhere = true;
    fetchNote.mockResolvedValue(noteWith(CFI));

    draw();

    await waitFor(() => expect(lastView().inits).toHaveLength(2));
    expect(lastView().inits[1]).not.toHaveProperty("lastLocation");
    expect(panel()).toBeNull();
  });

  it("draws the book when the saved place threw on its way in", async () => {
    // The other stale bookmark: an `idref` this book has and a node path it
    // has not, which throws out of `anchor(doc)` after the section has loaded.
    // Written this way round on purpose, because the obvious reading is wrong:
    // `lastLocation` is set by then, so the fallback never fires and it is the
    // catch that answers this shape.
    FakeView.initWith = () => Promise.reject(new Error("range.setStart"));
    fetchNote.mockResolvedValue(noteWith(CFI));

    draw();

    await waitFor(() => expect(lastView().inits).toHaveLength(1));
    // Let the rest of `draw` run, so a second `init` would be in by now.
    await act(async () => {});
    expect(panel()).toBeNull();
    expect(lastView().inits).toHaveLength(1);
  });

  it("says so when the note it reads beside has left the vault", async () => {
    draw({ paths: ["something/else.md"] });

    await waitFor(() => expect(panel()).toHaveTextContent(BOOK));
  });

  it("says nothing while the listing has not arrived", async () => {
    // Not knowing yet is not the same as gone. This passes before the
    // behaviour exists, so it guards against a later regression rather than
    // being a red step.
    draw({ paths: undefined });

    await waitFor(() => expect(lastView().started).toBe(true));
    expect(panel()).toBeNull();
  });

  it("paints the page in the app's own colours", async () => {
    draw();

    await waitFor(() => expect(lastView().styles).toContain(BACKGROUND));
  });

  it("still draws a book whose renderer cannot be styled", async () => {
    // foliate swaps in `fixed-layout.js` for a pre-paginated book, and that
    // renderer has no `setStyles`. A plain call throws on a valid epub.
    FakeView.withStyles = false;

    draw();

    await waitFor(() => expect(lastView().started).toBe(true));
    expect(panel()).toBeNull();
  });

  it("takes the cursor when the route moves to its pane", async () => {
    // The programmatic path, the way `todo-pane.tsx` answers the same signal.
    // Nothing else covers it, and without it a reader never holds the focus,
    // so `q` and every chord act on whichever pane the route still believes is
    // focused.
    const pane = draw();
    await waitFor(() => expect(lastView().started).toBe(true));

    pane.signal(1);

    expect(document.activeElement).toBe(pane.wrapper());
  });

  it("leaves the cursor alone in a pane that is not focused", async () => {
    // The route hands an unfocused pane 0, so a key that moved the focus
    // somewhere else does not have every reader on screen grab it.
    const pane = draw();
    await waitFor(() => expect(lastView().started).toBe(true));

    pane.signal(0);

    expect(document.activeElement).not.toBe(pane.wrapper());
  });

  it("leaves one live view behind React's double mount", async () => {
    const open = deferred();
    FakeView.openWith = () => open.promise;

    draw({ seed: new Blob(["a book"]) });

    await waitFor(() => expect(FakeView.made).toHaveLength(2));
    await act(async () => {
      open.resolve();
      await open.promise;
    });

    const [first, second] = FakeView.made;
    // Closed after `open` settled, not only in the cleanup: there was no
    // renderer to close while it was still in flight.
    expect(first?.closes).toBeGreaterThan(0);
    expect(second?.closes).toBe(0);
    await waitFor(() => expect(second?.started).toBe(true));
  });

  it("closes a view whose open was still in flight when the pane went", async () => {
    const open = deferred();
    FakeView.openWith = () => open.promise;
    const { unmount } = draw();

    await waitFor(() => expect(FakeView.made).toHaveLength(1));
    unmount();
    await act(async () => {
      open.resolve();
      await open.promise;
    });

    // Twice: once in the cleanup, and once after the await, which is the one
    // that frees a renderer that did not exist yet the first time. A bare
    // return there leaks a live foliate view per cancelled mount.
    expect(lastView().closes).toBe(2);
  });
});

describe("the keys inside a book", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue(new Blob(["a book"]));
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

    press(lastView().section, "t");
    const dialog = screen.getByRole("dialog");
    press(dialog, "l");
    press(dialog, "h");
    press(dialog, "q");

    expect(lastView().nexts).toBe(0);
    expect(lastView().prevs).toBe(0);
    expect(book.commands.closeNote).not.toHaveBeenCalled();
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

describe("where the reader got to", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue(new Blob(["a book"]));
    fetchNote.mockResolvedValue("");
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  /** Draw a book, with the renderer ready to emit. */
  async function reading() {
    const pane = draw();
    await waitFor(() => expect(lastView().started).toBe(true));
    return pane;
  }

  /**
   * What foliate's paginator emits when the page moves.
   *
   * `whole` is the fraction the view works out over the whole book and writes
   * to `lastLocation`, which is not the one the event carries.
   */
  function relocate(
    detail: { reason?: string; index?: number; range?: Range | null; fraction?: number } = {},
    whole?: number,
  ) {
    act(() => lastView().emitRelocate(detail, whole));
  }

  it("reports every move but the one that opened the book", async () => {
    // One case and not two: "the first is not reported" passes on its own while
    // nothing is listening at all, so the count is what makes this red.
    FakeView.cfis = ["first", "second", "third"];
    const pane = await reading();

    relocate({ reason: "page" });
    relocate({ reason: "page" });
    relocate({ reason: "page" });

    expect(pane.onMoved).toHaveBeenCalledTimes(2);
    expect(pane.onMoved).toHaveBeenNthCalledWith(1, "second");
    expect(pane.onMoved).toHaveBeenNthCalledWith(2, "third");
  });

  it("builds the cfi out of what the event carried", async () => {
    // The renderer's detail holds no cfi (`paginator.js:960-969`), so the pane
    // asks the view for one with the index and range it was handed.
    await reading();
    const range = document.createRange();

    relocate({ reason: "page", index: 7, range });

    expect(lastView().asked).toEqual([{ index: 7, range }]);
  });

  it("says so on the way out", async () => {
    const pane = await reading();

    pane.unmount();

    expect(pane.onLeaving).toHaveBeenCalledTimes(1);
  });
  it("reports no resize as a page turn", async () => {
    // The case that pins listening on the renderer at all. The paginator
    // re-renders through `#scrollToAnchor` inside its own `ResizeObserver`, so
    // folding the tree or resizing the window relocates with nobody moving.
    FakeView.cfis = ["first", "second"];
    const pane = await reading();

    // Before the opening navigation, which it must not spend the drop on.
    relocate({ reason: "anchor" });
    relocate({ reason: "page" });
    relocate({ reason: "anchor" });
    relocate({ reason: "page" });

    expect(pane.onMoved).toHaveBeenCalledTimes(1);
    expect(pane.onMoved).toHaveBeenCalledWith("second");
  });

  it("reports the page moving to show a selection as nothing", async () => {
    FakeView.cfis = ["first", "second"];
    const pane = await reading();

    relocate({ reason: "selection" });
    relocate({ reason: "page" });
    relocate({ reason: "selection" });
    relocate({ reason: "page" });

    expect(pane.onMoved).toHaveBeenCalledTimes(1);
    expect(pane.onMoved).toHaveBeenCalledWith("second");
  });

  it("reports a move carrying no reason at all", async () => {
    // A scrolled flow's keyboard turn and a fixed layout jump both arrive with
    // nothing naming them. This passes before the refusals exist, so it guards
    // against an allowlist creeping in rather than being a red step.
    FakeView.cfis = ["first", "second"];
    const pane = await reading();

    relocate({ reason: "page" });
    relocate({});

    expect(pane.onMoved).toHaveBeenCalledTimes(1);
    expect(pane.onMoved).toHaveBeenCalledWith("second");
  });

  it("reports nothing for a turn that settled on the page it was already on", async () => {
    // `#scrollTo` fires its relocate when the offset it was given is the one it
    // is already at, which is what a touch fling settling back does.
    FakeView.cfis = ["first", "second", "second"];
    const pane = await reading();

    relocate({ reason: "page" });
    relocate({ reason: "snap" });
    relocate({ reason: "snap" });

    expect(pane.onMoved).toHaveBeenCalledTimes(1);
  });

  it("says how far through the whole book the page is", async () => {
    // The number the footer wants is the one the view worked out over every
    // section, not the `fraction` on the event, which is how far through the
    // chapter you are. This is the case that fails if the pane reads the event.
    await reading();

    relocate({ reason: "page", fraction: 0.2 }, 0.42);

    expect(progress()).toBe("42%");
  });

  it("follows the page rather than reading the fraction once", async () => {
    await reading();

    relocate({ reason: "page" }, 0.42);
    relocate({ reason: "page" }, 0.6);

    expect(progress()).toBe("60%");
  });

  it("says nothing at all where the fraction is not a number", async () => {
    // A book whose sections all measure zero divides zero by zero
    // (`progress.js:60,83`), and one foliate built no `#sectionProgress` for
    // carries no fraction at all (`view.js:240-242`). Neither is a percentage.
    await reading();

    relocate({ reason: "page" }, 0.42);
    // Asserted on the way, or the two below pass over a footer that never drew
    // a percentage at all.
    expect(progress()).toBe("42%");

    relocate({ reason: "page" }, Number.NaN);
    expect(progress()).toBe("");

    relocate({ reason: "page" }, 0.42);
    relocate({ reason: "page" });
    expect(progress()).toBe("");
  });

  it("moves the percentage for a re-render that is not a page turn", async () => {
    // The two early returns keep a re-render from writing a bookmark. Neither
    // is a reason to leave the footer saying where the page used to be.
    const pane = await reading();

    relocate({ reason: "anchor" }, 0.42);

    expect(progress()).toBe("42%");
    expect(pane.onMoved).not.toHaveBeenCalled();
  });

  it("says nothing about a book that has not reported a page yet", async () => {
    // Passes before the behaviour exists, so it guards against a later
    // regression rather than being a red step.
    await reading();

    expect(progress()).toBe("");
  });

  it("hears nothing once the pane has gone", async () => {
    // Passes before the behaviour exists, the cleanup already taking the
    // listener off, so it is a regression guard rather than a red step.
    const pane = await reading();
    const view = lastView();

    pane.unmount();
    act(() => view.emitRelocate({ reason: "page" }));

    expect(pane.onMoved).not.toHaveBeenCalled();
  });
});
