import { act, fireEvent, screen } from "@testing-library/react";
import { rubberBand } from "@/lib/sheet-math";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { boardHooks, boardPane } from "./todo-board-pane-fixture";

// The module rather than `fetch`, as the list's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

boardHooks();

/** The phone's column under the tabs, the element the swipe moves. */
function column(): HTMLElement {
  return screen.getByRole("tablist").nextElementSibling as HTMLElement;
}

/**
 * One finger on `el` at height 100. The clock is a stub the test moves, so a
 * release after a pause reads a speed of 0 and a release at once reads a flick.
 */
function finger(el: HTMLElement, x: number, pointerId = 1) {
  return {
    down: () =>
      fireEvent.pointerDown(el, { pointerType: "touch", pointerId, clientX: x, clientY: 100 }),
    move: (to: number) =>
      fireEvent.pointerMove(el, { pointerType: "touch", pointerId, clientX: to, clientY: 100 }),
    up: (to: number) =>
      fireEvent.pointerUp(el, { pointerType: "touch", pointerId, clientX: to, clientY: 100 }),
  };
}

describe("the phone board's column swipe (#811 A8 I1 I2)", () => {
  let clock = 1000;
  let now: { mockRestore(): void };
  let width: { mockRestore(): void };

  beforeEach(() => {
    clock = 1000;
    now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    // The column measures 390 px wide, a phone.
    width = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 390,
      height: 600,
      top: 0,
      left: 0,
      right: 390,
      bottom: 600,
    } as DOMRect);
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  });

  afterEach(() => {
    now.mockRestore();
    width.mockRestore();
    vi.useRealTimers();
  });

  /** Lets the finger rest a while, so the release reads no speed, then lifts it. */
  function rest(el: HTMLElement, to: number, pointerId = 1) {
    clock += 200;
    finger(el, to, pointerId).up(to);
  }

  it("#811 A8 a swipe moves the column 1:1 with the finger", async () => {
    await boardPane();
    const col = column();
    const hand = finger(col, 300);

    hand.down();
    hand.move(250);
    expect(col.style.transform).toBe("translateX(-50px)");
    hand.move(220);
    expect(col.style.transform).toBe("translateX(-80px)");
  });

  it("#811 A8 a swipe past a quarter shows the next state and its tab", async () => {
    const pane = await boardPane();
    const col = column();
    const hand = finger(col, 300);

    hand.down();
    hand.move(150);
    rest(col, 150);

    expect(screen.getByRole("tab", { name: "Doing 1" }).getAttribute("aria-selected")).toBe("true");
    expect(pane.texts()).toEqual([expect.stringContaining("draw the chart")]);
    // The new column comes in from the side the finger went, and springs to rest.
    expect(col.style.transform).toBe("translateX(390px)");
  });

  it("#811 A8 a swipe right shows the previous state", async () => {
    await boardPane();
    fireEvent.click(screen.getByRole("tab", { name: "Doing 1" }));
    const col = column();
    const hand = finger(col, 100);

    hand.down();
    hand.move(250);
    rest(col, 250);

    expect(screen.getByRole("tab", { name: "Open 3" }).getAttribute("aria-selected")).toBe("true");
  });

  it("#811 A8 the first column pulled right gives less than the finger, a rubber band", async () => {
    await boardPane();
    const col = column();
    const hand = finger(col, 200);

    hand.down();
    hand.move(300);

    expect(col.style.transform).toBe(`translateX(${rubberBand(100, 390)}px)`);
  });

  it("#811 A8 a vertical drag leaves the column to the page", async () => {
    await boardPane();
    const col = column();
    const hand = finger(col, 200);

    hand.down();
    fireEvent.pointerMove(col, { pointerType: "touch", pointerId: 1, clientX: 200, clientY: 160 });

    expect(col.style.transform).toBe("");
    // The column claims only the sideways pan and the pinch, so the page keeps its scroll (#811 R7.7).
    expect(col.style.touchAction).toBe("pan-y pinch-zoom");
    expect(col.style.overscrollBehaviorX).toBe("contain");
    expect(fireEvent.touchMove(col)).toBe(true);
  });

  it("#811 A8 a touch from the screen edge does not swipe", async () => {
    await boardPane();
    const col = column();

    // A middle touch swipes, so the column can move at all.
    const middle = finger(col, 200);
    middle.down();
    middle.move(150);
    expect(col.style.transform).toBe("translateX(-50px)");
    rest(col, 150);

    // A touch from the left edge is the system's, so it moves nothing.
    const edge = finger(col, 5, 3);
    edge.down();
    edge.move(300);
    expect(col.style.transform).toBe("translateX(-50px)");
  });

  it("#811 I1 a long press lifts the card and the column does not swipe", async () => {
    const pane = await boardPane();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const card = pane.card("send the invoice");
    const col = column();

    fireEvent.pointerDown(card, { pointerType: "touch", pointerId: 1, clientX: 200, clientY: 100 });
    act(() => vi.advanceTimersByTime(400));
    expect(card.hasAttribute("data-lifted")).toBe(true);
    fireEvent.pointerMove(col, { pointerType: "touch", pointerId: 1, clientX: 100, clientY: 100 });

    expect(col.style.transform).toBe("");
    expect(screen.getByRole("tab", { name: "Open 3" }).getAttribute("aria-selected")).toBe("true");
  });

  it("#811 I1 a swipe started on a card lifts nothing and opens nothing", async () => {
    const pane = await boardPane();
    const card = pane.card("send the invoice");
    const col = column();
    const hand = finger(card, 300);

    hand.down();
    hand.move(250);
    rest(col, 250);
    // The click a swipe ends with, which the finger's lift would have sent.
    fireEvent.click(card);

    expect(document.querySelectorAll("[data-lifted]").length).toBe(0);
    expect(pane.onOpen).not.toHaveBeenCalled();
  });

  it("#811 I2 a short swipe springs back and changes nothing", async () => {
    const pane = await boardPane();
    const col = column();
    const hand = finger(col, 300);

    hand.down();
    hand.move(270);
    expect(col.style.transform).toBe("translateX(-30px)");
    rest(col, 270);

    expect(screen.getByRole("tab", { name: "Open 3" }).getAttribute("aria-selected")).toBe("true");
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("#811 I2 a mouse drag never swipes", async () => {
    await boardPane();
    const col = column();

    fireEvent.pointerDown(col, { pointerType: "mouse", pointerId: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(col, { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(col, { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 100 });

    expect(col.style.transform).toBe("");
    expect(screen.getByRole("tab", { name: "Open 3" }).getAttribute("aria-selected")).toBe("true");
  });

  it("#811 I2 a second finger ends the swipe", async () => {
    const pane = await boardPane();
    const col = column();
    const first = finger(col, 300);

    first.down();
    first.move(250);
    expect(col.style.transform).toBe("translateX(-50px)");
    // A second finger lands on the column while the first is mid swipe.
    fireEvent.pointerDown(col, { pointerType: "touch", pointerId: 2, clientX: 320, clientY: 100 });
    first.move(100);
    expect(col.style.transform).toBe("translateX(-50px)");
    rest(col, 100);

    expect(screen.getByRole("tab", { name: "Open 3" }).getAttribute("aria-selected")).toBe("true");
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("#811 I3 on the phone h and l move the shown column as a tab does", async () => {
    const pane = await boardPane();

    pane.press("l");

    expect(screen.getByRole("tab", { name: "Doing 1" }).getAttribute("aria-selected")).toBe("true");
    expect(pane.texts()).toEqual([expect.stringContaining("draw the chart")]);

    pane.press("h");

    expect(screen.getByRole("tab", { name: "Open 3" }).getAttribute("aria-selected")).toBe("true");
    expect(pane.texts()).toContainEqual(expect.stringContaining("send the invoice"));
  });
});
