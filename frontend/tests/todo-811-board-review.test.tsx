import { act, fireEvent, screen } from "@testing-library/react";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { BOARD, boardHooks, boardPane, DAILY, INVOICE } from "./todo-board-pane-fixture";

// The module rather than `fetch`, as the list's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

boardHooks();

const FDE = "02 Projects/FDE";

/** The column under the tabs, the element the swipe moves. */
function column(): HTMLElement {
  return screen.getByRole("tablist").nextElementSibling as HTMLElement;
}

/** The heading button of a lane, the button that folds it. */
function laneHeadingButton(name: string): HTMLButtonElement {
  const heading = screen.getAllByRole("heading").find((one) => one.textContent === name);
  const button = heading?.querySelector("button");
  if (!button) throw new Error(`no lane heading button named ${name}`);
  return button;
}

/** Hold a finger on a card until the long press picks it up. */
function hold(card: HTMLElement) {
  fireEvent.pointerDown(card, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
  act(() => vi.advanceTimersByTime(400));
}

describe("the board's review fixes (#811 R7)", () => {
  afterEach(() => vi.useRealTimers());

  it("#811 R7.1 a lane folded during a carry ends the carry, so the drop writes nothing", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "project" }));

    hold(pane.card("fix the tap"));
    fireEvent.pointerOver(document.querySelector(`[data-lane="${FDE}"]`) as HTMLElement, {
      pointerType: "touch",
      pointerId: 1,
    });
    // A second finger folds the lane the card is carried over.
    fireEvent.click(laneHeadingButton("FDE"));
    fireEvent.pointerUp(document.body, { pointerType: "touch", pointerId: 1 });

    expect(pane.onRefile).not.toHaveBeenCalled();
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("#811 R7.2 h and l do nothing while a card is carried, and the drop writes the cell it is over", async () => {
    const pane = await boardPane();
    const card = pane.card("send the invoice");
    fireEvent.pointerDown(card, { pointerType: "mouse", pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { pointerType: "mouse", pointerId: 1, clientX: 30, clientY: 10 });
    const done = document.querySelector('[data-lane="#client"][data-column="done"]') as HTMLElement;
    fireEvent.pointerEnter(done, { pointerType: "mouse", pointerId: 1 });

    pane.press("l");

    // The Open column is still the shown one, so its heading still reads as shown.
    expect(screen.getAllByTestId("todo-column")[0]?.className).toContain("text-k-ink");
    fireEvent.pointerUp(done, { pointerType: "mouse", pointerId: 1 });
    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(INVOICE, "done");
  });

  it("#811 R7.6 a done card with a past date reads muted, not red", async () => {
    const DONE_LATE = {
      path: DAILY,
      line: 9,
      text: "- [x] file the form 📅 2026-08-01 ✅ 2026-08-09",
      project: null,
      shared: false,
    };
    const pane = await boardPane({ hits: [...BOARD, DONE_LATE] });
    const due = Array.from(pane.card("file the form").querySelectorAll("span")).find(
      (span) => span.textContent === "08-01",
    );

    expect(due?.className).toContain("text-k-muted");
    expect(due?.className).not.toContain("text-k-danger");
  });

  it("#811 R7.7 the swipe column lets the pinch zoom the page", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await boardPane();

    expect(column().style.touchAction).toBe("pan-y pinch-zoom");
  });

  it("#811 F2 with reduced motion a swipe step lands at rest at once", async () => {
    stubMatchMedia({
      [NARROW]: true,
      [COARSE]: true,
      "(prefers-reduced-motion: reduce)": true,
    });
    const pane = await boardPane();
    const col = column();
    const width = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 390,
      height: 600,
      top: 0,
      left: 0,
      right: 390,
      bottom: 600,
    } as DOMRect);
    try {
      fireEvent.pointerDown(col, {
        pointerType: "touch",
        pointerId: 1,
        clientX: 300,
        clientY: 100,
      });
      fireEvent.pointerMove(col, {
        pointerType: "touch",
        pointerId: 1,
        clientX: 150,
        clientY: 100,
      });
      fireEvent.pointerUp(col, { pointerType: "touch", pointerId: 1, clientX: 150, clientY: 100 });

      expect(screen.getByRole("tab", { name: "Doing 1" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(col.style.transform).toBe("translateX(0px)");
      expect(pane.texts()).toEqual([expect.stringContaining("draw the chart")]);
    } finally {
      width.mockRestore();
    }
  });

  it("#811 F1 a lost pointer capture on a card inside the column does not end the swipe", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    const col = column();
    const width = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 390,
      height: 600,
      top: 0,
      left: 0,
      right: 390,
      bottom: 600,
    } as DOMRect);
    try {
      fireEvent.pointerDown(col, {
        pointerType: "touch",
        pointerId: 1,
        clientX: 300,
        clientY: 100,
      });
      fireEvent.pointerMove(col, {
        pointerType: "touch",
        pointerId: 1,
        clientX: 250,
        clientY: 100,
      });
      expect(col.style.transform).toBe("translateX(-50px)");

      // The card's own button held the finger first, so its capture is what is lost.
      fireEvent.lostPointerCapture(pane.card("send the invoice"), { pointerId: 1 });
      fireEvent.pointerMove(col, {
        pointerType: "touch",
        pointerId: 1,
        clientX: 220,
        clientY: 100,
      });

      expect(col.style.transform).toBe("translateX(-80px)");
    } finally {
      width.mockRestore();
    }
  });

  it("#811 R7.9 a tab tapped by a second finger while a card is carried ends the carry and the release writes nothing", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    hold(pane.card("send the invoice"));
    // The first finger is over the Done tab, which a release there would set.
    fireEvent.pointerOver(screen.getByRole("tab", { name: /^Done/ }), {
      pointerType: "touch",
      pointerId: 1,
    });
    // A second finger taps the Waiting tab.
    const waiting = screen.getByRole("tab", { name: /^Waiting/ });
    fireEvent.pointerDown(waiting, { pointerType: "touch", pointerId: 2 });
    fireEvent.pointerUp(waiting, { pointerType: "touch", pointerId: 2 });
    fireEvent.click(waiting);
    fireEvent.pointerUp(document.body, { pointerType: "touch", pointerId: 1 });

    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onRefile).not.toHaveBeenCalled();
  });
});
