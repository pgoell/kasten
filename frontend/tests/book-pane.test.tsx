import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { BookPane } from "@/components/book-pane";
import { bookPath } from "@/lib/note-path";
import { deferred, defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";
import { stubCommands } from "./stub-commands";

const { fetchBook } = vi.hoisted(() => ({ fetchBook: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchBook }));

// The factory is not optional. A bare `vi.mock(path)` automocks, and vitest's
// automock keeps the module body and replaces only its exports, so the real
// `customElements.define("foliate-view", View)` would run and the fake's own
// define would then throw. An empty factory stops the module evaluating at all.
vi.mock("foliate-js/view.js", () => ({}));

const NOTE = "20 Literature/DDIA.md";
const BOOK = "20 Literature/DDIA.epub";

/** What the One background reads as, so the styling case has a value to find. */
const BACKGROUND = "#282c34";

defineFoliateFake();

function draw(props: { note?: string; paths?: string[]; seed?: Blob } = {}) {
  const commands = stubCommands();
  const onFocus = vi.fn();
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
      />
    </QueryClientProvider>
  );

  const view = render(props.seed ? <StrictMode>{tree(0)}</StrictMode> : tree(0));
  return {
    ...view,
    commands,
    onFocus,
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

describe("BookPane", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue(new Blob(["a book"]));
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

  it("says so when the first navigation fails", async () => {
    FakeView.initWith = () => Promise.reject(new Error("nowhere to go"));

    draw();

    await waitFor(() => expect(panel()).toHaveTextContent(BOOK));
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
