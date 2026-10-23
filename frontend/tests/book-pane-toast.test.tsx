import { act, cleanup, waitFor } from "@testing-library/react";
import { CFI, CHAPTERS, draw, selects } from "./book-pane-fixture";
import { defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

const { fetchBook, fetchNote, uploadAsset } = vi.hoisted(() => ({
  fetchBook: vi.fn(),
  fetchNote: vi.fn(),
  uploadAsset: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchBook, fetchNote, uploadAsset }));

// The factory is not optional: see `book-pane-touch.test.tsx`.
vi.mock("foliate-js/view.js", () => ({}));

defineFoliateFake();

describe("the book pane's take toast", () => {
  beforeEach(() => {
    resetFoliateFake();
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    fetchBook.mockResolvedValue({ path: "20 Literature/DDIA.epub", blob: new Blob(["a book"]) });
    fetchNote.mockResolvedValue("");
    FakeView.toc = CHAPTERS;
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  /** A box 400 wide at the window's left edge, which is the pane and the frame both. */
  const BOX = { left: 0, top: 0, width: 400, height: 600 } as DOMRect;

  it("draws the take toast over the text column and not over the footer or a column", async () => {
    const pane = draw();
    await waitFor(() => expect(lastView().started).toBe(true));
    const frame = document.createElement("iframe");
    frame.getBoundingClientRect = () => BOX;
    (pane.wrapper() as HTMLElement).getBoundingClientRect = () => BOX;
    const doc = lastView().section;
    Object.defineProperty(doc, "defaultView", { value: { frameElement: frame } });
    doc.createRange = () => {
      const range = Document.prototype.createRange.call(doc);
      range.getClientRects = () => [BOX] as unknown as DOMRectList;
      return range;
    };
    act(() => lastView().emitLoad());

    pane.onTake.mockResolvedValue("hl-a3f9c1");
    lastView().lastLocation = { cfi: CFI, tocItem: CHAPTERS[0] };
    selects("A sentence worth keeping.");
    const button = pane.container.querySelector("footer [data-take]") as HTMLElement | null;
    await act(async () => button?.click());

    await waitFor(() => expect(pane.container.querySelector("[role=status]")).not.toBeNull());
    const status = pane.container.querySelector("[role=status]");
    // The text column is the box the foliate host sits in, which holds the toast too.
    const column = pane.container.querySelector("foliate-view")?.parentElement?.parentElement;
    expect(column?.contains(status ?? null)).toBe(true);
    expect(pane.container.querySelector("footer")?.contains(status ?? null)).toBe(false);
    expect(pane.container.querySelector("nav")?.contains(status ?? null) ?? false).toBe(false);
  });
});
