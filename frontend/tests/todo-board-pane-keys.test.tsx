import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  BOARD,
  boardHooks,
  boardPane,
  DAILY,
  DECK,
  INVOICE,
  NUMBERS,
  PLAN,
  renderPane,
  TAP,
} from "./todo-board-pane-fixture";

// The module rather than `fetch`, as the list's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

boardHooks();

describe("the todo board", () => {
  it("A6 X moves the card to done through onCycle, and x cycles it", async () => {
    const pane = await boardPane();
    expect(pane.cursor()).toContain("send the invoice");

    pane.press("X");
    expect(pane.onCycle).toHaveBeenLastCalledWith(INVOICE, "done");
    pane.press("W");
    expect(pane.onCycle).toHaveBeenLastCalledWith(INVOICE, "waiting");
    pane.press("x");
    expect(pane.onCycle).toHaveBeenLastCalledWith(INVOICE);
  });

  it("A7 Enter or a click on a card opens its line", async () => {
    const pane = await boardPane();

    pane.press("Enter");
    expect(pane.onOpen).toHaveBeenCalledWith(DAILY, 4);

    fireEvent.click(pane.card("write the deck"));
    expect(pane.onOpen).toHaveBeenLastCalledWith(PLAN, 1);
  });

  it("A8 p opens the project picker, Enter picks, Escape closes", async () => {
    const pane = await boardPane();
    pane.press("j");
    pane.press("j");
    expect(pane.cursor()).toContain("fix the tap");

    pane.press("p");
    expect(pane.choices()).toEqual(["FDE", "Kasten"]);
    pane.press("Escape");
    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
    expect(pane.onEdit).not.toHaveBeenCalled();

    pane.press("p");
    pane.press("j");
    pane.press("Enter");
    expect(pane.onEdit).toHaveBeenCalledWith(
      TAP,
      expect.stringContaining("fix the tap [[02 Projects/Kasten/index|Kasten]]"),
    );
    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
  });

  it("A8 a click picks, and a card already filed there writes nothing", async () => {
    const pane = await boardPane();

    pane.press("p");
    fireEvent.click(screen.getByRole("button", { name: "FDE" }));

    expect(pane.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
  });

  it("A9 h l move between columns and j k between the cards of one, across lanes", async () => {
    // The keys land on the pane, never in CodeMirror, so vim mode is not a
    // setting this test needs to turn.
    const pane = await boardPane();

    pane.press("l");
    expect(pane.cursor()).toContain("draw the chart");
    pane.press("h");
    expect(pane.cursor()).toContain("send the invoice");
    pane.press("j");
    expect(pane.cursor()).toContain("write the deck");
    pane.press("j");
    expect(pane.cursor()).toContain("fix the tap");
    pane.press("j");
    expect(pane.cursor()).toContain("fix the tap");
    pane.press("k");
    expect(pane.cursor()).toContain("write the deck");
  });

  it("A11 the filter line and the views narrow the cards", async () => {
    const pane = await boardPane();

    fireEvent.change(pane.filter(), { target: { value: "#client" } });
    expect(pane.texts()).toEqual([expect.stringContaining("send the invoice")]);

    fireEvent.change(pane.filter(), { target: { value: "" } });
    pane.press("v");
    pane.press("v");
    await waitFor(() => expect(pane.filter().value).toBe("/doing"));
    expect(pane.texts()).toEqual([expect.stringContaining("draw the chart")]);
  });

  it("I1 a card moved out of its column leaves the cursor and the focus on one that is there", async () => {
    const pane = await boardPane({ focusSignal: 1 });
    await waitFor(() => expect(document.activeElement?.textContent).toContain("send the invoice"));

    pane.press("X");
    pane.answer(
      BOARD.map((hit) =>
        hit === INVOICE ? { ...hit, text: `${hit.text.replace("[ ]", "[x]")} ✅ 2026-08-10` } : hit,
      ),
    );

    await waitFor(() => expect(pane.cursor()).toContain("write the deck"));
    expect(document.activeElement?.textContent).toContain("write the deck");
  });

  it("I3 an empty board and an empty column draw, and keys on them do nothing", async () => {
    const pane = renderPane({ hits: [] });
    await waitFor(() => expect(fetchTodos).toHaveBeenCalled());
    pane.press("c");
    expect(screen.getByText("nothing on the board")).toBeDefined();
    for (const key of ["j", "k", "h", "l", "x", "X", "Enter", "p", "g"]) pane.press(key);
    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onOpen).not.toHaveBeenCalled();

    cleanup();
    const full = await boardPane();
    // Review holds nothing.
    full.press("l");
    full.press("l");
    for (const key of ["j", "k", "x", "O", "Enter", "p"]) full.press(key);
    expect(full.onCycle).not.toHaveBeenCalled();
    expect(full.onOpen).not.toHaveBeenCalled();
    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
  });

  it("I4 q, Escape, / and a leader sequence still work on the board", async () => {
    const editor = document.createElement("div");
    editor.className = "cm-content";
    editor.tabIndex = -1;
    document.body.append(editor);
    const pane = await boardPane();

    pane.press(" ");
    pane.press("c");
    pane.press("t");
    expect(pane.reached).toEqual(["createTab"]);
    // The `c` went to the leader, so the board is still up.
    expect(pane.cards().length).toBeGreaterThan(0);

    pane.press("/");
    expect(document.activeElement).toBe(pane.filter());

    pane.press("Escape");
    expect(document.activeElement).toBe(editor);

    pane.press("q");
    expect(pane.reached).toEqual(["createTab", "closeNote"]);
    editor.remove();
  });

  it("I5 a done card moved with O goes back to open through onCycle", async () => {
    const pane = await boardPane();
    for (const key of ["l", "l", "l", "l", "l"]) pane.press(key);
    expect(pane.cursor()).toContain("gather numbers");

    pane.press("O");
    expect(pane.onCycle).toHaveBeenCalledWith(NUMBERS, "open");
  });

  it("I6 the board hands on the hit the vault answered with, never a rebuilt todo", async () => {
    const pane = await boardPane();
    pane.press("j");

    pane.press("P");
    expect(pane.onCycle.mock.calls[0]?.[0]).toBe(DECK);

    pane.press("j");
    pane.press("p");
    pane.press("Enter");
    expect(pane.onEdit.mock.calls[0]?.[0]).toBe(TAP);
  });
});
