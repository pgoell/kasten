import { act, cleanup, screen, waitFor } from "@testing-library/react";
import {
  BOOK,
  CFI,
  CHAPTERS,
  draw,
  PASSAGE,
  rows,
  selects,
  selectsNothing,
} from "./book-pane-fixture";
import {
  deferred,
  defineFoliateFake,
  FakeView,
  lastView,
  resetFoliateFake,
  sectionsOf,
} from "./foliate-fake";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

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

describe("a book under a finger", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchBook.mockResolvedValue({ path: BOOK, blob: new Blob(["a book"]) });
    fetchNote.mockResolvedValue("");
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  /** A box 400 wide at the window's left edge, which is the pane and the frame both. */
  const BOX = { left: 0, top: 0, width: 400, height: 600 } as DOMRect;

  /**
   * Draw a book whose section sits in a frame, which no jsdom document does.
   *
   * The fake's section comes from `createHTMLDocument` and has no
   * `defaultView`, so the frame is arranged here: an iframe the size of the
   * pane, and a rectangle for every range, jsdom laying nothing out.
   */
  async function opened(phone = true, held?: ReturnType<typeof deferred>) {
    if (phone) stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    // A held `init` is a book still opening: the page has drawn, but the
    // paginator's 100ms turn lock has not let go yet (#372).
    if (held) FakeView.initWith = () => held.promise;
    const pane = draw();
    await waitFor(() => expect(lastView().inits).toHaveLength(1));
    if (!held) await waitFor(() => expect(lastView().started).toBe(true));

    const frame = document.createElement("iframe");
    frame.getBoundingClientRect = () => BOX;
    Object.defineProperty(frame, "offsetWidth", { value: BOX.width });
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

  /** Tap the page `x` pixels from the pane's left edge, on `target` or on the body. */
  function tap(x: number, target: Element = lastView().section.body) {
    act(() => {
      target.dispatchEvent(
        new MouseEvent("click", { clientX: x, bubbles: true, cancelable: true }),
      );
    });
  }

  // By side and not by order: the fake counts `goLeft` and `goRight` apart
  // from `prev` and `next`, which is what a book read right to left tells apart.
  it("goes right on a tap near the right edge", async () => {
    await opened();

    tap(350);

    expect(lastView().rights).toBe(1);
    expect(lastView().lefts + lastView().nexts + lastView().prevs).toBe(0);
  });

  it("goes left on a tap near the left edge", async () => {
    await opened();

    tap(50);

    expect(lastView().lefts).toBe(1);
    expect(lastView().rights + lastView().nexts + lastView().prevs).toBe(0);
  });

  it("turns nothing on a tap in the middle of the page", async () => {
    await opened();

    tap(200);

    expect(lastView().lefts + lastView().rights).toBe(0);
  });

  it("turns nothing for a tap something in the page already answered", async () => {
    await opened();
    const button = lastView().section.createElement("button");
    lastView().section.body.append(button);
    button.addEventListener("click", (event) => event.preventDefault());

    tap(350, button);

    expect(lastView().lefts + lastView().rights).toBe(0);
  });

  it("leaves a tap on a link to the link", async () => {
    await opened();
    const doc = lastView().section;
    const link = doc.createElement("a");
    link.href = "ch2.xhtml";
    doc.body.append(link);

    tap(350, link);

    expect(lastView().rights).toBe(0);
  });

  it("turns nothing while words are selected", async () => {
    await opened();
    selects("A sentence worth keeping.");

    tap(350);

    expect(lastView().rights).toBe(0);
  });

  it("leaves a click at the edge alone under a mouse", async () => {
    await opened(false);

    tap(350);

    expect(lastView().rights).toBe(0);
  });

  /** Let a held `init` go, and everything `draw` does after it. */
  async function release(held: ReturnType<typeof deferred>) {
    await act(async () => {
      held.resolve();
      await new Promise((settle) => setTimeout(settle, 0));
    });
  }

  // The fake holds no turn lock, so a turn made while the book is opening
  // counts here where the real paginator drops it. Hence the assertion before
  // the release: nothing may be turned yet.
  it("goes right once the book opens, for a tap near the right edge while it opened, by side", async () => {
    const held = deferred();
    await opened(true, held);

    tap(350);
    expect(lastView().rights).toBe(0);
    await release(held);

    expect(lastView().rights).toBe(1);
    expect(lastView().lefts + lastView().nexts + lastView().prevs).toBe(0);
  });

  it("goes left once the book opens, for a tap near the left edge while it opened, by side", async () => {
    const held = deferred();
    await opened(true, held);

    tap(50);
    expect(lastView().lefts).toBe(0);
    await release(held);

    expect(lastView().lefts).toBe(1);
    expect(lastView().rights + lastView().nexts + lastView().prevs).toBe(0);
  });

  it("turns nothing for a click at the edge under a mouse while the book opened", async () => {
    const held = deferred();
    await opened(false, held);

    tap(350);
    expect(lastView().rights).toBe(0);
    await release(held);

    expect(lastView().rights).toBe(0);
  });

  it("parks nothing for a tap in the middle or on a link while the book opened", async () => {
    const held = deferred();
    await opened(true, held);
    const doc = lastView().section;
    const link = doc.createElement("a");
    link.href = "ch2.xhtml";
    doc.body.append(link);

    tap(200);
    tap(350, link);
    await release(held);

    expect(lastView().lefts + lastView().rights).toBe(0);
  });

  it("goes to a passage handed over while the book opened, over a tap", async () => {
    FakeView.sections = sectionsOf([PASSAGE]);
    const held = deferred();
    const pane = await opened(true, held);

    act(() => pane.send([PASSAGE]));
    tap(350);
    await release(held);

    await waitFor(() => expect(lastView().gone).toHaveLength(1));
    expect(lastView().rights).toBe(0);
  });

  it("makes the last of an l and a tap while the book opened, and only that", async () => {
    const held = deferred();
    await opened(true, held);

    act(() => {
      lastView().section.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    });
    tap(350);
    await release(held);

    expect(lastView().rights).toBe(1);
    expect(lastView().nexts).toBe(0);
  });

  it("drops a tap made while the book opened when the pane goes first", async () => {
    const held = deferred();
    const { unmount } = await opened(true, held);

    tap(350);
    unmount();
    await release(held);

    expect(lastView().rights).toBe(0);
  });

  it("opens the contents from the footer, the way t does", async () => {
    FakeView.toc = CHAPTERS;
    await opened();

    act(() => screen.getByRole("button", { name: "Contents" }).click());

    expect(rows()).toEqual(["One", "Two"]);
  });

  it("takes a selection from the footer, the way y does", async () => {
    const pane = await opened();
    lastView().lastLocation = { cfi: CFI, tocItem: CHAPTERS[0] };
    expect(pane.container.querySelector("[data-take]")).toBeNull();

    selects("A sentence worth keeping.");
    // In the footer and not floating over the words, where the phone draws its
    // own copy menu.
    const button = pane.container.querySelector("footer [data-take]") as HTMLElement;
    await act(async () => button.click());

    expect(pane.onTake).toHaveBeenCalledWith({
      text: "A sentence worth keeping.",
      chapter: "One",
      image: undefined,
    });
    expect(pane.container.querySelector("[data-take]")).toBeNull();
  });

  it("still takes a passage the press on Take put away", async () => {
    const pane = await opened();
    lastView().lastLocation = { cfi: CFI, tocItem: CHAPTERS[0] };
    selects("A sentence worth keeping.");
    const button = pane.container.querySelector("footer [data-take]") as HTMLElement;

    // A `MouseEvent` under the pointer's name, the way `tap` builds its click:
    // React listens by type, and whether this jsdom has a `PointerEvent` is
    // then nobody's question.
    const press = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);

    // What a phone does for a tap outside the frame the words are in.
    selectsNothing();
    // Still there, or the click below would land on whatever took its place.
    expect(pane.container.querySelector("footer [data-take]")).toBe(button);

    await act(async () => button.click());

    expect(pane.onTake).toHaveBeenCalledWith({
      text: "A sentence worth keeping.",
      chapter: "One",
      image: undefined,
    });
    expect(pane.container.querySelector("[data-take]")).toBeNull();
  });

  it("lets go of a press that slid off Take before it was lifted", async () => {
    const pane = await opened();
    selects("A sentence worth keeping.");
    const button = pane.container.querySelector("footer [data-take]") as HTMLElement;
    act(() => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
    // Off the button with the words still selected: the press is over, and
    // the next collapse is an ordinary one again. jsdom lays nothing out, so
    // the button is a point at the origin and anywhere else is off it.
    act(() => {
      button.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 200 }));
    });
    expect(pane.container.querySelector("footer [data-take]")).toBe(button);
    selectsNothing();
    expect(pane.container.querySelector("[data-take]")).toBeNull();

    // And off the button after the press itself put the words away: nothing
    // is selected, so nothing is left to take and no click is coming.
    selects("A sentence worth keeping.");
    const again = pane.container.querySelector("footer [data-take]") as HTMLElement;
    act(() => {
      again.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
    selectsNothing();
    expect(pane.container.querySelector("footer [data-take]")).toBe(again);
    act(() => {
      again.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 200 }));
    });
    expect(pane.container.querySelector("[data-take]")).toBeNull();
    expect(pane.onTake).not.toHaveBeenCalled();
  });

  it("forgets the passage for a collapse no press made", async () => {
    const pane = await opened();
    selects("A sentence worth keeping.");

    selectsNothing();

    expect(pane.container.querySelector("[data-take]")).toBeNull();
  });

  it("draws neither button in the footer under a mouse", async () => {
    const pane = await opened(false);

    selects("A sentence worth keeping.");

    expect(screen.queryByRole("button", { name: "Contents" })).toBeNull();
    expect(pane.container.querySelector("footer [data-take]")).toBeNull();
    // The mouse's own button, over the words, is still the one that is drawn.
    expect(pane.container.querySelector("[data-take]")).not.toBeNull();
  });
});
