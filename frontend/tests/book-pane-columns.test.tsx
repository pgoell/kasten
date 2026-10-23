import { act, cleanup, waitFor, within } from "@testing-library/react";
import { CFI, CHAPTERS, draw, NOTE, noteHolding, OTHER, PASSAGE } from "./book-pane-fixture";
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

/** Each pane's observer by the element it watches, so a case can say how wide one pane is. */
const watching = new Map<Element, ResizeObserverCallback>();

/** A ResizeObserver that remembers what it watches, and reports a width only when a case asks. */
class Measuring {
  private readonly callback: ResizeObserverCallback;
  private readonly elements: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    this.elements.push(element);
    watching.set(element, this.callback);
  }

  unobserve(element: Element) {
    watching.delete(element);
  }

  disconnect() {
    for (const element of this.elements) watching.delete(element);
  }
}

/** Tell the pane `element` is `width` wide, the way a resize of the pane does. */
function widen(element: Element | null, width: number) {
  const callback = element === null ? undefined : watching.get(element);
  act(() => {
    callback?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
  });
}

/** The contents column of a pane, or null where it is not drawn. */
function contentsOf(container: HTMLElement) {
  return within(container).queryByRole("navigation", { name: "Book contents" });
}

/** The note column of a pane, or null where it is not drawn. */
function takenOf(container: HTMLElement) {
  return within(container).queryByRole("region", { name: "Taken" });
}

describe("the book pane's columns", () => {
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

  async function opened(props: Parameters<typeof draw>[0] = {}) {
    const pane = draw(props);
    await waitFor(() => expect(lastView().inits).toHaveLength(1));
    await waitFor(() => expect(lastView().started).toBe(true));
    return pane;
  }

  it("draws the contents column from 960 px and not at 959", async () => {
    const pane = await opened();

    widen(pane.wrapper(), 959);
    expect(contentsOf(pane.container)).toBeNull();

    widen(pane.wrapper(), 960);
    expect(contentsOf(pane.container)).not.toBeNull();
  });

  it("draws the note column from 1280 px and not at 1279", async () => {
    const pane = await opened();

    widen(pane.wrapper(), 1279);
    expect(takenOf(pane.container)).toBeNull();
    expect(contentsOf(pane.container)).not.toBeNull();

    widen(pane.wrapper(), 1280);
    expect(takenOf(pane.container)).not.toBeNull();
  });

  it("lets each pane of a split decide its own columns from its own width", async () => {
    const left = await opened();
    const right = await opened();

    widen(left.wrapper(), 1280);
    widen(right.wrapper(), 1000);

    expect(takenOf(left.container)).not.toBeNull();
    expect(contentsOf(left.container)).not.toBeNull();
    expect(takenOf(right.container)).toBeNull();
    expect(contentsOf(right.container)).not.toBeNull();
  });

  it("marks the current chapter and moves the mark when the chapter changes", async () => {
    const pane = await opened();
    widen(pane.wrapper(), 960);

    act(() => {
      lastView().lastLocation = { cfi: CFI, tocItem: CHAPTERS[0] };
      lastView().emitRelocate({ reason: "page" }, 0.1);
    });
    const marked = () =>
      within(pane.container)
        .queryAllByRole("button")
        .filter((row) => row.getAttribute("aria-current") === "true")
        .map((row) => row.textContent);
    expect(marked()).toEqual(["One"]);

    act(() => {
      lastView().lastLocation = { cfi: CFI, tocItem: CHAPTERS[1] };
      lastView().emitRelocate({ reason: "page", index: 1 }, 0.6);
    });
    expect(marked()).toEqual(["Two"]);
  });

  it("goes to a chapter when its row is clicked", async () => {
    const pane = await opened();
    widen(pane.wrapper(), 960);

    const row = within(pane.container).queryByRole("button", { name: "Two" });
    expect(row).not.toBeNull();
    act(() => row?.click());

    expect(lastView().gone).toEqual(["ch2.xhtml"]);
  });

  it("lists the passages taken so far and follows the note's text", async () => {
    const pane = await opened({ held: noteHolding(PASSAGE) });
    widen(pane.wrapper(), 1280);
    expect(within(pane.container).queryByRole("button", { name: PASSAGE })).not.toBeNull();

    act(() => pane.client.setQueryData(["note", NOTE], noteHolding(PASSAGE, OTHER)));

    // The query's observers are told on a timer, so the column catches up a tick later.
    await waitFor(() =>
      expect(within(pane.container).queryByRole("region", { name: "Taken" })?.textContent).toBe(
        `Taken${PASSAGE}${OTHER}`,
      ),
    );
  });

  it("seeks a passage when its row in the note column is clicked", async () => {
    FakeView.sections = sectionsOf([PASSAGE]);
    const pane = await opened({ held: noteHolding(PASSAGE) });
    widen(pane.wrapper(), 1280);
    const row = within(pane.container).queryByRole("button", { name: PASSAGE });
    expect(row).not.toBeNull();

    act(() => row?.click());

    await waitFor(() => expect(lastView().gone).toHaveLength(1));
  });
});
