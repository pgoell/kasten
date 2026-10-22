import { act, cleanup, waitFor } from "@testing-library/react";
import { BACKGROUND, BOOK, CFI, draw, NOTE, noteWith, panel } from "./book-pane-fixture";
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

describe("BookPane", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue({ path: BOOK, blob: new Blob(["a book"]) });
    // A string and not undefined: the pane reads a field off what this answers,
    // and `mockResolvedValue(undefined)` is a default too, one that draws the
    // error panel over every case in this file.
    fetchNote.mockResolvedValue("");
    document.documentElement.style.setProperty("--k-bg", BACKGROUND);
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

  it("names the note, and both suffixes, when nothing sits beside it", async () => {
    fetchBook.mockRejectedValue(new Error("GET /api/books failed with 404"));

    draw();

    // The note and not a file, because the file is the half that is missing
    // and the pane no longer works out what it would have been called. Both
    // suffixes because either would answer, which is what "goes here" means.
    await waitFor(() => expect(panel()).toHaveTextContent(NOTE));
    expect(panel()).toHaveTextContent(".epub or .pdf");
  });

  it("says so for a book of no bytes", async () => {
    // foliate throws `NotFoundError` on `!file.size`, which reads as a broken
    // library rather than as an empty file.
    fetchBook.mockResolvedValue({ path: BOOK, blob: new Blob([]) });

    draw();

    await waitFor(() => expect(panel()).toHaveTextContent(NOTE));
  });

  it("says so when the book cannot be opened", async () => {
    FakeView.openWith = () => Promise.reject(new Error("not an epub"));

    draw();

    await waitFor(() => expect(panel()).toHaveTextContent(NOTE));
  });

  it("says so when the first navigation fails and nothing loaded", async () => {
    // Both halves, because a throw on its own is a stale bookmark now: the
    // panel is drawn only where the retry below fails too, which is a book
    // foliate opened and cannot render a page of.
    FakeView.navigatesNowhere = true;
    FakeView.initWith = () => Promise.reject(new Error("nowhere to go"));

    draw();

    await waitFor(() => expect(panel()).toHaveTextContent(NOTE));
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

    await waitFor(() => expect(panel()).toHaveTextContent(NOTE));
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
    // Neither is closed: the first mount's view is dropped before a section
    // ever loaded, and closing one of those throws.
    expect(first?.closes).toBe(0);
    expect(second?.closes).toBe(0);
    await waitFor(() => expect(second?.started).toBe(true));
  });

  it("leaves a book that never rendered a page alone on the way out", async () => {
    // The tab switch that took the app down. `close` reaches
    // `Paginator.destroy`, which dereferences the inner view the paginator only
    // builds when a section loads, so a pane that goes away before the first
    // page is drawn throws out of its own cleanup, and React unmounts
    // everything from there up. The window is as long as that page takes.
    FakeView.navigatesNowhere = true;
    const start = deferred();
    FakeView.initWith = () => start.promise;
    const { unmount } = draw();

    await waitFor(() => expect(lastView().inits).toHaveLength(1));
    const view = lastView();
    unmount();

    expect(view.closes).toBe(0);
  });

  it("closes the book it drew when the pane goes", async () => {
    // The other half, and the one the guard above must not take with it: a
    // section did load, so there is a live iframe to free.
    const { unmount } = draw();
    await waitFor(() => expect(lastView().started).toBe(true));

    unmount();

    expect(lastView().closes).toBe(1);
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

    // Nothing to free: `open` never finished, so no section loaded and the
    // element the cleanup removed took the renderer with it.
    expect(lastView().closes).toBe(0);
  });
});
