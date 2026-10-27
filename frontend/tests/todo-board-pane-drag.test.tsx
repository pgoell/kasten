import { act, fireEvent, screen } from "@testing-library/react";
import { toggleVim } from "@/lib/editor/vim-setting";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { BOARD, boardHooks, boardPane, DAILY, DECK, INVOICE, TAP } from "./todo-board-pane-fixture";

// The module rather than `fetch`, as the list's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

boardHooks();

describe("dragging a card (#397)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  const FDE = "02 Projects/FDE";
  const KASTEN = "02 Projects/Kasten";
  /** A card filed under Kasten, so lanes by project draw a second project to refile into. */
  const BUG = {
    path: "02 Projects/Kasten/plan.md",
    line: 1,
    text: "- [ ] fix the bug",
    project: KASTEN,
    shared: false,
  };

  /** A desktop cell, by its lane's id and its column. */
  function cell(lane: string, column: string): HTMLElement {
    return document.querySelector(`[data-lane="${lane}"][data-column="${column}"]`) as HTMLElement;
  }

  /** A phone's block of one lane under the tab shown. */
  function block(lane: string): HTMLElement {
    return document.querySelector(`[data-lane="${lane}"]`) as HTMLElement;
  }

  /** Pick a card up with the mouse: press, then move past what a click may wobble. */
  function lift(card: HTMLElement) {
    fireEvent.pointerDown(card, { pointerType: "mouse", pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { pointerType: "mouse", pointerId: 1, clientX: 30, clientY: 10 });
  }

  /** Hold a finger on a card until the long press picks it up. */
  function hold(card: HTMLElement) {
    fireEvent.pointerDown(card, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(400));
  }

  /** Carry the card over `zone` and let go there. */
  function drop(zone: HTMLElement, pointerType = "mouse") {
    fireEvent.pointerEnter(zone, { pointerType, pointerId: 1 });
    fireEvent.pointerUp(zone, { pointerType, pointerId: 1 });
  }

  const lifted = () => document.querySelectorAll("[data-lifted]").length;

  it("#397 A1 a card dragged by mouse onto another column sets its state through onCycle", async () => {
    const pane = await boardPane();

    lift(pane.card("send the invoice"));
    drop(cell("#client", "done"));

    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(INVOICE, "done");
    expect(pane.onRefile).not.toHaveBeenCalled();
  });

  it("#397 A2 a card dragged from No project onto a project lane refiles it there", async () => {
    const pane = await boardPane();
    pane.press("g");

    lift(pane.card("fix the tap"));
    drop(cell(FDE, "open"));

    expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(TAP, FDE);
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("#397 A3 a long press on a phone picks a card up and a drop on a tab sets the state", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    vi.useFakeTimers();

    hold(pane.card("send the invoice"));
    expect(pane.card("send the invoice").hasAttribute("data-lifted")).toBe(true);
    // The press is the page's now: no menu, and the finger does not scroll.
    expect(fireEvent.contextMenu(pane.card("send the invoice"))).toBe(false);
    expect(fireEvent.touchMove(pane.card("send the invoice"))).toBe(false);
    drop(screen.getByRole("tab", { name: /^Done/ }), "touch");

    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(INVOICE, "done");
  });

  it("#397 A3 while a card is up on a phone every column's tab is in sight", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    vi.useFakeTimers();
    const tabs = screen.getByRole("tablist");
    expect(tabs.hasAttribute("data-carrying")).toBe(false);
    expect(tabs.className).toContain("overflow-x-auto");

    // The finger holds the page still from here, so no tab can be scrolled to.
    hold(pane.card("send the invoice"));

    expect(tabs.hasAttribute("data-carrying")).toBe(true);
    expect(tabs.className).toContain("flex-wrap");
    expect(tabs.className).not.toContain("overflow-x-auto");
  });

  it("#397 A3 a touch press holds a non-passive touchmove listener from the start and blocks nothing before the lift", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    vi.useFakeTimers();
    const card = pane.card("send the invoice");
    const added = vi.spyOn(window, "addEventListener");
    try {
      fireEvent.pointerDown(card, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });

      // Android may make a touch's moves uncancelable once one has gone by
      // unasked, so the listener is there before the long press ends.
      expect(added).toHaveBeenCalledWith("touchmove", expect.any(Function), { passive: false });
      expect(fireEvent.touchMove(card)).toBe(true);
      act(() => vi.advanceTimersByTime(400));
      expect(fireEvent.touchMove(card)).toBe(false);
    } finally {
      added.mockRestore();
    }
  });

  it("#397 B1 switching lanes mid-drag cancels the drag and writes nothing", async () => {
    const pane = await boardPane();
    pane.press("g");

    lift(pane.card("send the invoice"));
    expect(lifted()).toBe(1);
    pane.press("g");
    expect(lifted()).toBe(0);
    drop(cell("#client", "open"));

    expect(pane.onRefile).not.toHaveBeenCalled();
    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onNotice).not.toHaveBeenCalled();
  });

  it("#397 B3 a second pointer's release does not drop the card", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    vi.useFakeTimers();
    const done = screen.getByRole("tab", { name: /^Done/ });
    const waiting = screen.getByRole("tab", { name: /^Waiting/ });

    hold(pane.card("send the invoice"));
    fireEvent.pointerEnter(done, { pointerType: "touch", pointerId: 1 });
    // A second finger passes over another tab and lets go.
    fireEvent.pointerEnter(waiting, { pointerType: "touch", pointerId: 2 });
    fireEvent.pointerUp(waiting, { pointerType: "touch", pointerId: 2 });
    expect(lifted()).toBe(1);
    expect(pane.onCycle).not.toHaveBeenCalled();

    fireEvent.pointerUp(done, { pointerType: "touch", pointerId: 1 });
    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(INVOICE, "done");
  });

  it("#397 A3 a long press on a phone and a drop on a lane of the column shown refiles", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    fireEvent.click(screen.getByRole("button", { name: "project" }));
    vi.useFakeTimers();

    hold(pane.card("fix the tap"));
    drop(block(FDE), "touch");

    expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(TAP, FDE);
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  // The board never reads the vim setting and its pointer never reaches
  // CodeMirror, so the two runs differ in the setting alone.
  for (const vim of ["on", "off"]) {
    it(`#397 A4 a mouse drag sets the state the same way, vim ${vim}`, async () => {
      toggleVim();
      if (vim === "on") toggleVim();
      expect(localStorage.getItem("kasten.vim")).toBe(vim);
      const pane = await boardPane();

      lift(pane.card("send the invoice"));
      drop(cell("#client", "doing"));

      expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(INVOICE, "doing");
    });
  }

  it("#397 A5 after a drag the keys still work as they did", async () => {
    const pane = await boardPane();
    lift(pane.card("send the invoice"));
    drop(cell("#client", "done"));
    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(INVOICE, "done");

    expect(pane.cursor()).toContain("send the invoice");
    pane.press("X");
    expect(pane.onCycle).toHaveBeenLastCalledWith(INVOICE, "done");
    pane.press("x");
    expect(pane.onCycle).toHaveBeenLastCalledWith(INVOICE);
    pane.press("m");
    expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(INVOICE);
    pane.press("j");
    expect(pane.cursor()).toContain("write the deck");
    pane.press("l");
    expect(pane.cursor()).toContain("draw the chart");
    pane.press("g");
    expect(pane.headings()).toEqual(["No project", "FDE"]);
  });

  it("#397 I1 a drop on the cell the card left writes nothing, and its click opens nothing", async () => {
    const pane = await boardPane();

    lift(pane.card("send the invoice"));
    fireEvent.pointerEnter(cell("#client", "open"), { pointerType: "mouse", pointerId: 1 });
    expect(lifted()).toBe(1);
    expect(cell("#client", "open").hasAttribute("data-over")).toBe(true);
    fireEvent.pointerUp(cell("#client", "open"), { pointerType: "mouse", pointerId: 1 });

    expect(lifted()).toBe(0);
    // The click a mouse makes as it lets go over the card it lifted.
    fireEvent.click(pane.card("send the invoice"));
    expect(pane.onOpen).not.toHaveBeenCalled();
    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onRefile).not.toHaveBeenCalled();
    fireEvent.click(pane.card("send the invoice"));
    expect(pane.onOpen).toHaveBeenCalledExactlyOnceWith(DAILY, 4);
  });

  it("#397 I2 Escape during a drag cancels it and writes nothing", async () => {
    const pane = await boardPane();

    lift(pane.card("send the invoice"));
    fireEvent.pointerEnter(cell("#client", "done"), { pointerType: "mouse", pointerId: 1 });
    expect(lifted()).toBe(1);
    pane.press("Escape");
    expect(lifted()).toBe(0);
    fireEvent.pointerUp(cell("#client", "done"), { pointerType: "mouse", pointerId: 1 });

    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onRefile).not.toHaveBeenCalled();
  });

  it("#397 I2 a drop outside any cell writes nothing", async () => {
    const pane = await boardPane();

    lift(pane.card("send the invoice"));
    fireEvent.pointerEnter(cell("#client", "done"), { pointerType: "mouse", pointerId: 1 });
    fireEvent.pointerLeave(cell("#client", "done"), { pointerType: "mouse", pointerId: 1 });
    expect(lifted()).toBe(1);
    fireEvent.pointerUp(document.body, { pointerType: "mouse", pointerId: 1 });

    expect(lifted()).toBe(0);
    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onRefile).not.toHaveBeenCalled();
  });

  it("#397 I4 a card with parts hands on its own hit alone, for a state and for a refile", async () => {
    // The deck and its two parts, beside a card that draws a Kasten lane.
    const pane = await boardPane({ hits: [...BOARD.slice(0, 3), BUG] });

    lift(pane.card("write the deck"));
    drop(cell("#internal", "waiting"));
    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(DECK, "waiting");

    pane.press("g");
    lift(pane.card("write the deck"));
    drop(cell(KASTEN, "open"));
    expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(DECK, KASTEN);
  });

  it("#397 I5 a finger that moves before the long press scrolls and picks nothing up", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    vi.useFakeTimers();
    const card = pane.card("send the invoice");

    fireEvent.pointerDown(card, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 40 });
    act(() => vi.advanceTimersByTime(400));
    expect(lifted()).toBe(0);
    expect(fireEvent.touchMove(card)).toBe(true);
    drop(screen.getByRole("tab", { name: /^Done/ }), "touch");

    // The browser taking the finger for a scroll ends the press the same way.
    fireEvent.pointerDown(card, { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(card, { pointerType: "touch", pointerId: 1 });
    act(() => vi.advanceTimersByTime(400));
    expect(lifted()).toBe(0);
    expect(pane.onCycle).not.toHaveBeenCalled();

    // A finger held still is the press that picks the card up.
    hold(card);
    expect(lifted()).toBe(1);
  });

  it("#397 I7 a drop that changes lane and column at once writes nothing and says why", async () => {
    const pane = await boardPane();
    pane.press("g");

    lift(pane.card("fix the tap"));
    drop(cell(FDE, "done"));

    expect(pane.onNotice).toHaveBeenCalledExactlyOnceWith(
      "Nothing moved: drop in the same column to refile, or in the same lane to set the state",
    );
    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onRefile).not.toHaveBeenCalled();
  });

  it("#397 I7 a card a #p tag files, dropped on another project lane, writes nothing and says why", async () => {
    const pane = await boardPane({
      hits: [{ ...BUG, text: "- [ ] fix the bug #p/kasten" }, ...BOARD.slice(0, 1)],
    });
    pane.press("g");

    lift(pane.card("fix the bug"));
    drop(cell(FDE, "open"));

    expect(pane.onNotice).toHaveBeenCalledExactlyOnceWith(
      "Nothing moved: its #p tag decides its lane",
    );
    expect(pane.onRefile).not.toHaveBeenCalled();
  });
});
