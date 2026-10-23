import { act, cleanup, waitFor, within } from "@testing-library/react";
import { CHAPTERS, draw, noteHolding, PASSAGE } from "./book-pane-fixture";
import {
  defineFoliateFake,
  FakeView,
  lastView,
  resetFoliateFake,
  sectionsOf,
} from "./foliate-fake";

const { fetchBook, fetchNote, uploadAsset } = vi.hoisted(() => ({
  fetchBook: vi.fn(),
  fetchNote: vi.fn(),
  uploadAsset: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchBook, fetchNote, uploadAsset }));

// The factory is not optional: see `book-pane-touch.test.tsx`.
vi.mock("foliate-js/view.js", () => ({}));

defineFoliateFake();

/** Each pane's observer by the element it watches, so a case can say how wide the pane is. */
const watching = new Map<Element, ResizeObserverCallback>();

/** A ResizeObserver that reports a width only when a case asks it to. */
class Measuring {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    watching.set(element, this.callback);
  }

  unobserve(element: Element) {
    watching.delete(element);
  }

  disconnect() {}
}

/** Tell the pane `element` is `width` wide, the way a resize of the pane does. */
function widen(element: Element | null, width: number) {
  const callback = element === null ? undefined : watching.get(element);
  act(() => {
    callback?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
  });
}

describe("the book pane's column rows", () => {
  beforeEach(() => {
    resetFoliateFake();
    vi.stubGlobal("ResizeObserver", Measuring);
    fetchBook.mockResolvedValue({ path: "20 Literature/DDIA.epub", blob: new Blob(["a book"]) });
    fetchNote.mockResolvedValue("");
    FakeView.toc = CHAPTERS;
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes the contents and note rows Tab stops that are 44 px under a finger", async () => {
    FakeView.sections = sectionsOf([PASSAGE]);
    const pane = draw({ held: noteHolding(PASSAGE) });
    await waitFor(() => expect(lastView().started).toBe(true));
    widen(pane.wrapper(), 1280);

    const contents = within(pane.container).queryByRole("navigation", { name: "Book contents" });
    const taken = within(pane.container).queryByRole("region", { name: "Taken" });
    const rows = [
      ...(contents === null ? [] : within(contents).queryAllByRole("button")),
      ...(taken === null ? [] : within(taken).queryAllByRole("button")),
    ];
    // Two chapters and one passage: every row of both columns, and none missing.
    expect(rows).toHaveLength(CHAPTERS.length + 1);

    for (const row of rows) {
      expect(row.className).toContain("pointer-coarse:min-h-11");
      expect(row.tabIndex).not.toBe(-1);
      row.focus();
      expect(document.activeElement).toBe(row);
    }
  });
});
