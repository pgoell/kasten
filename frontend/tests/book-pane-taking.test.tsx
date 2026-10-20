import { act, cleanup, waitFor } from "@testing-library/react";
import type { TocItem } from "@/components/book-contents";
import {
  BOOK,
  CFI,
  CHAPTERS,
  draw,
  FILED,
  selects,
  selectsFigure,
  selectsNothing,
} from "./book-pane-fixture";
import { defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";

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

describe("taking a passage into the note", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue({ path: BOOK, blob: new Blob(["a book"]) });
    fetchNote.mockResolvedValue("");
    uploadAsset.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  /** Draw a book and report its first section document, the way foliate does. */
  async function opened(props: Parameters<typeof draw>[0] = {}) {
    const pane = draw(props);
    await waitFor(() => expect(lastView().started).toBe(true));
    act(() => lastView().emitLoad());
    return pane;
  }

  function press(target: Document | Element, key: string) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  }

  /** Where the view says it is, which is where the chapter is read from. */
  function at(tocItem?: TocItem, section = { current: 0, total: 2 }) {
    lastView().lastLocation = { cfi: CFI, tocItem, section };
  }

  it("takes what is selected on y, with the chapter it was selected in", async () => {
    // No render between the selection and the press, which is the half that
    // fails against a pane holding the selection in state: `onKeyDown` is
    // built once with no dependencies, so a `y` branch closing over that state
    // reads the mount value, which is nothing, for good. The case below
    // catches the other half.
    const pane = await opened();
    at(CHAPTERS[0]);

    selects("Systems that tolerate faults are called fault-tolerant.");
    press(lastView().section, "y");

    expect(pane.onTake).toHaveBeenCalledTimes(1);
    expect(pane.onTake).toHaveBeenCalledWith({
      text: "Systems that tolerate faults are called fault-tolerant.",
      chapter: "One",
    });
  });

  it("keeps the chapter the selection was made in when the page turns inside the file", async () => {
    // One spine file often holds several toc entries, and paging inside one
    // loads nothing (`paginator.js:1004`), so `lastLocation.tocItem` moves
    // under a selection that is still perfectly alive. Reading the chapter at
    // the press pairs the words with a chapter they did not come from.
    const pane = await opened();
    at(CHAPTERS[0]);
    selects("A sentence from the first chapter.");

    at(CHAPTERS[1]);
    press(lastView().section, "y");

    expect(pane.onTake).toHaveBeenCalledWith({
      text: "A sentence from the first chapter.",
      chapter: "One",
    });
  });

  it("keeps it when the drag itself crosses into the next chapter", async () => {
    // The other half: a drag fires a `selectionchange` per move, so a pane
    // that recaptured on every one would name the chapter the drag ended in.
    const pane = await opened();
    at(CHAPTERS[0]);
    selects("A sentence from the first");

    at(CHAPTERS[1]);
    selects("A sentence from the first chapter, and one from the second.");
    press(lastView().section, "y");

    expect(pane.onTake).toHaveBeenCalledWith({
      text: "A sentence from the first chapter, and one from the second.",
      chapter: "One",
    });
  });

  it("takes nothing on y with nothing selected", async () => {
    const pane = await opened();

    press(lastView().section, "y");

    expect(pane.onTake).not.toHaveBeenCalled();
  });

  it("takes nothing once the selection has been let go of", async () => {
    const pane = await opened();
    at(CHAPTERS[0]);

    selects("A sentence worth keeping.");
    selectsNothing();
    press(lastView().section, "y");

    expect(pane.onTake).not.toHaveBeenCalled();
  });

  it("counts the section for a book whose publisher wrote no contents", async () => {
    // `current` is 3 and not the fake's own default of zero, which answers
    // `Section 1` and so cannot tell a pane that counts from a pane that hard
    // codes the floor.
    const pane = await opened();
    at(undefined, { current: 3, total: 9 });

    selects("A sentence worth keeping.");
    press(lastView().section, "y");

    expect(pane.onTake).toHaveBeenCalledWith({
      text: "A sentence worth keeping.",
      chapter: "Section 4",
    });
  });

  it("says the first section where the view has not said where it is", async () => {
    // Only the fake can arrange this: real foliate fills `section` on every
    // relocate an epub can make.
    const pane = await opened();
    lastView().lastLocation = null;

    selects("A sentence worth keeping.");
    press(lastView().section, "y");

    expect(pane.onTake).toHaveBeenCalledWith({
      text: "A sentence worth keeping.",
      chapter: "Section 1",
    });
  });

  it("counts the section for a label holding one non-breaking space", async () => {
    // foliate's own normaliser strips ASCII whitespace alone
    // (`epub.js:64-67`), so that label arrives truthy and would leave the
    // chapter line a bare caret.
    const pane = await opened();
    at({ id: 0, label: " ", href: "ch1.xhtml" }, { current: 0, total: 2 });

    selects("A sentence worth keeping.");
    press(lastView().section, "y");

    expect(pane.onTake).toHaveBeenCalledWith({
      text: "A sentence worth keeping.",
      chapter: "Section 1",
    });
  });

  it("files a figure the selection held and reports where it landed", async () => {
    const pane = await opened();
    at(CHAPTERS[0]);

    selectsFigure("Figure 4-3. A B-tree with three levels.");
    press(lastView().section, "y");

    await waitFor(() => expect(pane.onTake).toHaveBeenCalledTimes(1));
    const [path, blob] = uploadAsset.mock.calls[0] as [string, Blob];
    expect(path).toMatch(FILED);
    // The book's own bytes and its own media type, which is what makes the
    // vault take the file: a canvas would answer with a re-encode.
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
    expect(pane.onTake).toHaveBeenCalledWith({
      text: "Figure 4-3. A B-tree with three levels.",
      chapter: "One",
      image: path,
    });
  });

  it("takes a plate selected with no words at all", async () => {
    // `selection.toString()` is empty for a drag over a picture, so the text
    // alone cannot say whether anything is selected.
    const pane = await opened();
    at(CHAPTERS[0]);

    selectsFigure("");
    press(lastView().section, "y");

    await waitFor(() => expect(pane.onTake).toHaveBeenCalledTimes(1));
    expect(pane.onTake).toHaveBeenCalledWith({
      text: "",
      chapter: "One",
      image: expect.stringMatching(FILED),
    });
  });

  it("writes no highlight when the vault refuses the figure", async () => {
    // The paste's rule: a refused upload leaves the note as it was rather than
    // holding a reference to nothing. An `.svg` plate is the real case, the
    // vault holding no magic for one.
    const pane = await opened();
    at(CHAPTERS[0]);
    uploadAsset.mockRejectedValue(new Error("That file is not what its name says"));

    selectsFigure("Figure 4-3. A B-tree with three levels.");
    press(lastView().section, "y");

    await waitFor(() =>
      expect(pane.onNotice).toHaveBeenCalledWith("That file is not what its name says"),
    );
    expect(pane.onTake).not.toHaveBeenCalled();
  });

  it("reports no selection of whitespace alone", async () => {
    const pane = await opened();
    at(CHAPTERS[0]);

    selects(" \n ");
    press(lastView().section, "y");

    expect(pane.onTake).not.toHaveBeenCalled();
  });

  it("reports nothing at all in a fixed-layout book", async () => {
    // A spread shows two documents, the location names one side and carries no
    // range, and both frames are scaled, so each of the three would write a
    // wrong highlight rather than none.
    //
    // Set before the view is built rather than on the view afterwards, because
    // the real one reads it off the book's own rendition inside `open`
    // (`view.js:254`) and its renderer answers a different shape from then on.
    FakeView.fixedLayout = true;
    const pane = await opened();
    at(CHAPTERS[0]);

    selects("A sentence worth keeping.");
    press(lastView().section, "y");

    expect(pane.onTake).not.toHaveBeenCalled();
    expect(pane.container.querySelector("[data-take]")).toBeNull();
  });

  it("draws no button where the iframe cannot be reached", async () => {
    // Which is every case in this file: the fake's section document comes from
    // `createHTMLDocument` and has no `defaultView`, so there is no frame to
    // map through. It keeps this file honest about the half of the feature it
    // cannot test, and it fails against a `place` that assumes a frame.
    const pane = await opened();
    at(CHAPTERS[0]);

    selects("A sentence worth keeping.");

    expect(pane.container.querySelector("[data-take]")).toBeNull();
  });

  it("builds no second view when the selection changes", async () => {
    // The other half, and the case above does not catch it: naming the
    // selection in the view effect's dependencies tears the book down and
    // opens it again on every drag, losing the page.
    await opened();
    at(CHAPTERS[0]);

    selects("A sentence");
    selects("A sentence worth keeping.");

    expect(FakeView.made).toHaveLength(1);
    expect(lastView().closes).toBe(0);
  });

  it("drops the selection when another chapter's document loads", async () => {
    // Crossing a section takes the old document off the page
    // (`paginator.js:666-676`), so the range points at nothing on screen.
    const pane = await opened();
    at(CHAPTERS[0]);
    selects("A sentence from the chapter you left.");

    const second = document.implementation.createHTMLDocument("second");
    act(() => lastView().emitLoad(second));
    press(second, "y");

    expect(pane.onTake).not.toHaveBeenCalled();
  });
});
