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

describe("a book's take under a finger", () => {
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

  /** A book open and its section framed in the pane, the way the touch cases open one. */
  async function opened() {
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
    return pane;
  }

  it("puts Take in the footer at 44 px on a touch screen and shows the toast after a press", async () => {
    const pane = await opened();
    pane.onTake.mockResolvedValue("hl-a3f9c1");
    lastView().lastLocation = { cfi: CFI, tocItem: CHAPTERS[0] };
    selects("A sentence worth keeping.");

    const button = pane.container.querySelector("footer [data-take]");
    expect(button?.className ?? "").toContain("min-h-11");
    await act(async () => (button as HTMLElement | null)?.click());

    await waitFor(() => expect(document.body.textContent).toContain("Taken into the book's note"));
  });
});
