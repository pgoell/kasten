import { fireEvent, waitFor } from "@testing-library/react";
import { DEFAULT_VIEWS, VIEWS_NOTE } from "@/lib/todo/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { boardHooks, boardPane, DAILY } from "./todo-board-pane-fixture";

// The module rather than `fetch`, as the board's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

boardHooks();

const PASCAL = "03 Areas/08 People/Pascal.md";
const ALICIA = "03 Areas/08 People/Alicia.md";

/** Two cards in the client lane, the first with an assignee who has a note. */
const CHIPPED = [
  {
    path: DAILY,
    line: 1,
    text: "- [ ] send the invoice 👤 [[Pascal]] #client",
    project: null,
    shared: false,
  },
  {
    path: DAILY,
    line: 2,
    text: "- [ ] fix the tap 👤 Alicia #client",
    project: null,
    shared: false,
  },
];

/** The chip a card draws, which the card must hold. */
function chipOn(card: HTMLElement): HTMLElement {
  const chip = card.querySelector<HTMLElement>("[data-person]");
  expect(chip).not.toBeNull();
  return chip as HTMLElement;
}

/** A desktop cell, by its lane's id and its column. */
function cell(lane: string, column: string): HTMLElement {
  return document.querySelector(`[data-lane="${lane}"][data-column="${column}"]`) as HTMLElement;
}

describe("the assignee chip on a board card", () => {
  beforeEach(() => {
    vi.mocked(fetchFiles).mockResolvedValue([VIEWS_NOTE, DAILY, PASCAL, ALICIA]);
    vi.mocked(fetchNote).mockImplementation(async (path: string) =>
      path === PASCAL
        ? "---\ntype: Person\n---\n\n# Pascal\n"
        : path === ALICIA
          ? "---\ntype: Person\n---\n\n# Alicia\n"
          : DEFAULT_VIEWS,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("#809 A4 the board draws the chip on a card and a click on it opens the person note", async () => {
    const pane = await boardPane({ hits: CHIPPED });
    await waitFor(() =>
      expect(chipOn(pane.card("send the invoice"))).toHaveAttribute("data-person-path", PASCAL),
    );

    fireEvent.click(chipOn(pane.card("send the invoice")));

    expect(pane.onOpen).toHaveBeenCalledExactlyOnceWith(PASCAL, 1);
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("#809 A4 the phone board draws the chip on a card and a tap on it opens the person note", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane({ hits: CHIPPED });
    await waitFor(() =>
      expect(chipOn(pane.card("send the invoice"))).toHaveAttribute("data-person-path", PASCAL),
    );

    fireEvent.click(chipOn(pane.card("send the invoice")));

    expect(pane.onOpen).toHaveBeenCalledExactlyOnceWith(PASCAL, 1);
    expect(pane.onCycle).not.toHaveBeenCalled();
    // Only a card's `⋯` strip counts: a lane heading is aria-expanded too (#811 A6).
    expect(document.querySelector('[aria-label^="more for"][aria-expanded="true"]')).toBeNull();
  });

  it("#809 I2 a drag that starts on a board card's chip still moves the card", async () => {
    const pane = await boardPane({ hits: CHIPPED });
    const chip = chipOn(pane.card("send the invoice"));

    // The press starts on the chip and the card takes it, as a press on the card's face would.
    fireEvent.pointerDown(chip, { pointerType: "mouse", pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerType: "mouse", pointerId: 1, clientX: 30, clientY: 10 });
    fireEvent.pointerEnter(cell("#client", "done"), { pointerType: "mouse", pointerId: 1 });
    fireEvent.pointerUp(cell("#client", "done"), { pointerType: "mouse", pointerId: 1 });

    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: DAILY, line: 1 }),
      "done",
    );
    expect(pane.onOpen).not.toHaveBeenCalled();
  });
});
