import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { BookPane } from "@/components/book-pane";
import { BOOK, draw, NOTE, progress } from "./book-pane-fixture";
import { defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";
import { stubCommands } from "./stub-commands";

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

describe("where the reader got to", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue({ path: BOOK, blob: new Blob(["a book"]) });
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

  /**
   * A parent whose layout effect turns the page when `move` turns true.
   *
   * A child's layout effects run before its parent's, so the turn lands after
   * the pane has committed the render with the new `onMoved` and before any
   * passive effect of it has run, which `rerender` cannot reach: it flushes the
   * passive effects before it returns.
   */
  function MoveOnCommit({
    client,
    onMoved,
    move,
  }: {
    client: QueryClient;
    onMoved: (cfi: string) => void;
    move: boolean;
  }) {
    useLayoutEffect(() => {
      if (move) lastView().emitRelocate({ reason: "page" });
    }, [move]);
    return (
      <QueryClientProvider client={client}>
        <BookPane
          note={NOTE}
          commands={stubCommands()}
          onFocus={vi.fn()}
          onMoved={onMoved}
          onLeaving={vi.fn()}
          onTake={vi.fn()}
          onNotice={vi.fn()}
        />
      </QueryClientProvider>
    );
  }

  it("reports a relocate that lands before the passive effects of a render to the new onMoved", async () => {
    // The new `onMoved` is the one a folder move hands the pane, holding the
    // note's new path.
    FakeView.cfis = ["first", "second"];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const old = vi.fn();
    const fresh = vi.fn();
    const { rerender } = render(<MoveOnCommit client={client} onMoved={old} move={false} />);
    await waitFor(() => expect(lastView().started).toBe(true));
    relocate({ reason: "page" });

    rerender(<MoveOnCommit client={client} onMoved={fresh} move />);

    expect([old.mock.calls, fresh.mock.calls]).toEqual([[], [["second"]]]);
  });
});
