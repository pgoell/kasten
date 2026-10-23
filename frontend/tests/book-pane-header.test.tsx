import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { CFI, CHAPTERS, draw, progress } from "./book-pane-fixture";
import { defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";

const { fetchBook, fetchNote, uploadAsset } = vi.hoisted(() => ({
  fetchBook: vi.fn(),
  fetchNote: vi.fn(),
  uploadAsset: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchBook, fetchNote, uploadAsset }));

// The factory is not optional: see `book-pane-touch.test.tsx`.
vi.mock("foliate-js/view.js", () => ({}));

defineFoliateFake();

describe("the book pane's header and footer", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue({ path: "20 Literature/DDIA.epub", blob: new Blob(["a book"]) });
    fetchNote.mockResolvedValue("");
    FakeView.toc = CHAPTERS;
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  /** A book open at a place in the first chapter, 42% of the way through the book. */
  async function reading() {
    const pane = draw();
    await waitFor(() => expect(lastView().started).toBe(true));
    act(() => {
      lastView().lastLocation = { cfi: CFI, tocItem: CHAPTERS[0] };
      lastView().emitRelocate({ reason: "page" }, 0.42);
    });
    return pane;
  }

  it("reads BOOK, the title, the chapter, the percent and The book's note, in that order", async () => {
    const pane = await reading();

    expect(pane.container.querySelector("[data-book-pane] header")?.textContent).toBe(
      "BOOKDDIAOne42%The book's note",
    );
    expect(
      pane.container.querySelector(`[title="20 Literature/DDIA.md"]`)?.className ?? "",
    ).toContain("font-mono");
  });

  it("opens the book's note beside the book from The book's note", async () => {
    const pane = await reading();

    act(() => screen.queryByRole("button", { name: "The book's note" })?.click());

    expect(pane.onNoteBeside).toHaveBeenCalledTimes(1);
  });

  it("reads the chapter and the share of the book in the footer", async () => {
    await reading();

    expect(progress()).toBe("One42% of the book");
  });
});
