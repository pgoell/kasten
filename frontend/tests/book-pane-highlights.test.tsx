import { act, cleanup, waitFor } from "@testing-library/react";
import { BOOK, draw, IDS, NOTE, noteHolding, OTHER, PASSAGE, panel } from "./book-pane-fixture";
import {
  deferred,
  defineFoliateFake,
  documentOf,
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

// The factory is not optional. A bare `vi.mock(path)` automocks, and vitest's
// automock keeps the module body and replaces only its exports, so the real
// `customElements.define("foliate-view", View)` would run and the fake's own
// define would then throw. An empty factory stops the module evaluating at all.
vi.mock("foliate-js/view.js", () => ({}));

defineFoliateFake();

describe("drawing the note's highlights", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue({ path: BOOK, blob: new Blob(["a book"]) });
    fetchNote.mockResolvedValue("");
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  /** A book open beside a note holding `quotes`, with the section holding `words`. */
  async function reading(quotes: string[], words: string[] = quotes) {
    const pane = draw({ held: noteHolding(...quotes) });
    await waitFor(() => expect(lastView().started).toBe(true));
    lastView().section = documentOf(...words);
    return pane;
  }

  /** The overlay the section on screen is carrying, once one has arrived. */
  function overlay() {
    const held = lastView().overlayer;
    if (!held) throw new Error("no overlay was attached");
    return held;
  }

  it("draws every highlight the section holds once the overlay arrives", async () => {
    await reading([PASSAGE, OTHER]);

    act(() => lastView().emitCreateOverlay());

    await waitFor(() => expect(overlay().added).toEqual(IDS));
  });

  it("draws a note that arrives after the overlay did", async () => {
    // The race the two triggers exist for. The first section's overlay is
    // often built before the note query has answered, so that pass draws
    // nothing and the note arriving is what draws it.
    const pane = await reading([], [PASSAGE, OTHER]);

    act(() => lastView().emitCreateOverlay());
    act(() => {
      pane.client.setQueryData(["note", NOTE], noteHolding(PASSAGE, OTHER));
    });

    await waitFor(() => expect(overlay().keys).toEqual(IDS));
  });

  it("stops drawing a highlight the note no longer holds", async () => {
    const pane = await reading([PASSAGE, OTHER]);

    act(() => lastView().emitCreateOverlay());
    await waitFor(() => expect(overlay().added).toEqual(IDS));
    act(() => {
      pane.client.setQueryData(["note", NOTE], noteHolding(PASSAGE));
    });

    await waitFor(() => expect(overlay().keys).toEqual([IDS[0]]));
  });

  it("draws nothing for a highlight the section does not hold", async () => {
    // pin: a quote the book no longer holds is skipped in silence, which is
    // the story about editing a quote's wording by hand.
    await reading([PASSAGE, OTHER], [PASSAGE]);

    act(() => lastView().emitCreateOverlay());

    await waitFor(() => expect(overlay().added).toEqual([IDS[0]]));
  });

  it("draws into the overlay of the section that arrives next", async () => {
    // pin: paging into another highlighted chapter draws it as it arrives.
    await reading([PASSAGE, OTHER]);
    act(() => lastView().emitCreateOverlay());
    await waitFor(() => expect(overlay().added).toEqual(IDS));

    act(() => lastView().emitCreateOverlay(1));

    await waitFor(() => expect(overlay().added).toEqual(IDS));
  });

  it("draws nothing in a book whose sections carry no overlay", async () => {
    // pin: the fixed-layout book. foliate's own `getContents` there carries no
    // overlayer and no index, so there is nothing to draw on and the pane
    // needs no guard of its own beyond reading for one.
    await reading([PASSAGE, OTHER]);

    expect(lastView().overlayer).toBeUndefined();
    expect(panel()).toBeNull();
  });

  it("draws nothing on a fixed-layout page carrying no text layer", async () => {
    // The pre-paginated epub, whose renderer answers `{ doc }` and nothing
    // else (`fixed-layout.js:308-313`). The other half of the same guard: a
    // pdf page arrives in that shape too and the pane hangs an overlay in its
    // text layer, so the pass has to tell one from the other by the layer
    // rather than by the shape, and an epub page has none.
    FakeView.fixedLayout = true;
    await reading([PASSAGE, OTHER]);

    // The very sequence the first case in this block draws both highlights on.
    act(() => lastView().emitCreateOverlay());

    expect(lastView().overlayer?.added).toEqual([]);
    // And nothing hung by hand either, which is what the pane does to a pdf.
    expect(lastView().section.querySelector("svg")).toBeNull();
    expect(panel()).toBeNull();
  });

  it("draws nothing for a pane that went away between the emit and the pass", async () => {
    const pane = await reading([PASSAGE, OTHER]);
    const view = lastView();

    // Outside `act` and unmounted in the same task, which is the window the
    // microtask leaves: the handler queues and the stack has not emptied.
    view.emitCreateOverlay();
    pane.unmount();
    await Promise.resolve();

    expect(view.overlayer?.added).toEqual([]);
  });

  it("draws nothing again when the page turns inside one section", async () => {
    // pin: the case that fails without the memo on the blocks.
    // `highlightBlocks` answers a new array every call and this pane re-renders
    // on every page turn, so the pass would run again for a note nobody
    // touched.
    await reading([PASSAGE, OTHER]);
    act(() => lastView().emitCreateOverlay());
    await waitFor(() => expect(overlay().added).toEqual(IDS));

    act(() => lastView().emitRelocate({ reason: "page" }, 0.42));

    expect(overlay().added).toEqual(IDS);
  });

  it("walks the book to the section holding the passage it is handed", async () => {
    // The spine in the order the pane walks it: one holding other words, one
    // foliate cannot open, and the one holding the quote.
    //
    // The unopenable section is not first, and that is now load-bearing: the
    // pane reads the head of the spine to tell an epub from a pdf, a pdf's
    // sections carrying no `createDocument` at all (`pdf.js:150-160`), so a
    // spine beginning with one would send this book down the pdf arm. No real
    // epub begins that way, `epub.js:999` dropping every section it could not
    // build from the spine.
    FakeView.sections = sectionsOf([OTHER], null, [OTHER], [PASSAGE]);
    const pane = await reading([]);

    act(() => pane.send([PASSAGE]));

    await waitFor(() => expect(lastView().gone).toHaveLength(1));
    expect(lastView().asked.at(-1)?.index).toBe(3);
  });

  it("waits for the book to be ready before it walks", async () => {
    // `view.book` is not readiness: `open()` sets it before it has navigated
    // anywhere (`view.js:233-237`), so a seek testing it would walk, jump, and
    // then have the bookmark land on top of the passage.
    //
    // The assertion is on the walk not having started rather than on the order
    // of two `goTo` calls: the fake's `init` records its options and navigates
    // nowhere, so there is no bookmark call to come second.
    FakeView.sections = sectionsOf([PASSAGE]);
    const held = deferred();
    FakeView.initWith = () => held.promise;
    const pane = draw({ held: "" });
    await waitFor(() => expect(lastView().inits).toHaveLength(1));

    act(() => pane.send([PASSAGE]));
    await Promise.resolve();
    expect(lastView().gone).toEqual([]);

    await act(async () => {
      held.resolve();
    });

    await waitFor(() => expect(lastView().gone).toHaveLength(1));
  });

  it("lets the later of two presses win the walk", async () => {
    // The first section's document is held open, the second press arrives, and
    // then the first is let go. What this does not buy is an order on two
    // `goTo` calls already in flight, which the spec names and refuses.
    const held = deferred();
    const sections = sectionsOf([OTHER], [PASSAGE]);
    sections[0] = {
      createDocument: async () => {
        await held.promise;
        return documentOf(OTHER);
      },
    };
    FakeView.sections = sections;
    const pane = await reading([]);

    act(() => pane.send([OTHER]));
    act(() => pane.send([PASSAGE]));
    await act(async () => {
      held.resolve();
    });

    await waitFor(() => expect(lastView().gone).toHaveLength(1));
    expect(lastView().asked.at(-1)?.index).toBe(1);
  });

  it("navigates nothing for a pane unmounted mid-walk", async () => {
    const held = deferred();
    FakeView.sections = [
      {
        createDocument: async () => {
          await held.promise;
          return documentOf(PASSAGE);
        },
      },
    ];
    const pane = await reading([]);
    const view = lastView();

    act(() => pane.send([PASSAGE]));
    pane.unmount();
    await act(async () => {
      held.resolve();
    });

    expect(view.gone).toEqual([]);
  });

  it("says one sentence when no section holds the passage", async () => {
    // pin: a press gets an answer, which is the rule PR 4 and PR 5 follow.
    FakeView.sections = sectionsOf([OTHER], [OTHER]);
    const pane = await reading([]);

    act(() => pane.send([PASSAGE]));

    await waitFor(() =>
      expect(pane.onNotice).toHaveBeenCalledWith("That passage is not in the book"),
    );
    expect(pane.onNotice).toHaveBeenCalledTimes(1);
    expect(lastView().gone).toEqual([]);
  });

  it("builds no second view for a passage it is handed", async () => {
    // pin: the case that fails when the seek reaches the view effect's
    // dependencies and tears the book down on every press.
    FakeView.sections = sectionsOf([PASSAGE]);
    const pane = await reading([]);

    act(() => pane.send([PASSAGE]));
    await waitFor(() => expect(lastView().gone).toHaveLength(1));

    expect(FakeView.made).toHaveLength(1);
    expect(lastView().closes).toBe(0);
  });

  it("walks once for the same seek object handed over twice", async () => {
    // pin: what StrictMode does in development. The effect's own dependency
    // list answers it and no ref is kept for it.
    FakeView.sections = sectionsOf([PASSAGE]);
    const pane = await reading([]);
    const seek = { quote: [PASSAGE] };

    act(() => pane.hold(seek));
    await waitFor(() => expect(lastView().gone).toHaveLength(1));
    act(() => pane.hold(seek));

    expect(lastView().gone).toHaveLength(1);
  });

  it("builds no second view when the note changes", async () => {
    // pin: the case that fails when the blocks reach the view effect's
    // dependencies and tear the book down on every save.
    const pane = await reading([PASSAGE, OTHER]);

    act(() => {
      pane.client.setQueryData(["note", NOTE], noteHolding(PASSAGE));
    });

    expect(FakeView.made).toHaveLength(1);
    expect(lastView().closes).toBe(0);
  });
});
