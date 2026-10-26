import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toggleVim } from "@/lib/vim-setting";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { boardHooks, boardPane, CHART, DAILY, renderPane } from "./todo-board-pane-fixture";
import { pressFocused } from "./todo-pane-fixture";

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
  it("A10 a phone shows one column, a tab per column and a strip under each card", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Open 3",
      "Doing 1",
      "Review 0",
      "Waiting 0",
      "Blocked 1",
      "Done 1",
      "Rejected 1",
    ]);
    expect(pane.cards()).toHaveLength(3);

    fireEvent.click(screen.getByRole("tab", { name: "Done 1" }));
    expect(pane.texts()).toEqual([expect.stringContaining("gather numbers")]);

    fireEvent.click(screen.getByLabelText("more for gather numbers"));
    for (const label of [
      "open",
      "doing",
      "review",
      "done",
      "blocked",
      "waiting",
      "rejected",
      "project",
    ]) {
      expect(screen.getByLabelText(`${label} gather numbers`)).toBeDefined();
    }
    fireEvent.click(screen.getByLabelText("project gather numbers"));
    expect(pane.choices()).toEqual(["FDE", "Kasten"]);
  });

  it("I8 a state picked from the strip moves the card on one tap", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();

    fireEvent.click(screen.getByRole("tab", { name: "Doing 1" }));
    fireEvent.click(screen.getByLabelText("more for draw the chart"));
    fireEvent.click(screen.getByLabelText("done draw the chart"));

    expect(pane.onCycle).toHaveBeenCalledTimes(1);
    expect(pane.onCycle).toHaveBeenCalledWith(CHART, "done");
  });

  it("B4 cancel hands the focus back to the card under the cursor", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane({ focusSignal: 1 });
    await waitFor(() => expect(document.activeElement?.textContent).toContain("send the invoice"));

    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("project fix the tap"));
    const cancel = screen.getByRole("button", { name: "cancel" });
    cancel.focus();
    fireEvent.click(cancel);

    expect(document.activeElement).toBe(pane.card("send the invoice"));
  });

  it("B4 cancel on a touch screen shuts the project picker and writes nothing", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();

    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("project fix the tap"));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));

    expect(screen.queryByTestId("todo-project-pick")).toBeNull();
    expect(pane.onEdit).not.toHaveBeenCalled();
  });

  it("D7 a card on a touch screen is a full tap target", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();

    expect(pane.card("fix the tap").className).toContain("min-h-11");
  });

  it("#773 A3 enter on a focused more button opens its strip and does not open the cursor card", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    expect(pane.cursor()).toContain("send the invoice");
    screen.getByLabelText("more for fix the tap").focus();

    pressFocused("Enter");

    expect(pane.onOpen).not.toHaveBeenCalled();
    expect(screen.getByLabelText("done fix the tap")).toBeDefined();
  });

  it("#773 A3 space on a focused column tab shows that column", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    screen.getByRole("tab", { name: "Doing 1" }).focus();

    pressFocused(" ");

    expect(pane.texts()).toEqual([expect.stringContaining("draw the chart")]);
  });

  it("#773 A3 enter on a focused strip button runs it, not the cursor card's open", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    fireEvent.click(screen.getByRole("tab", { name: "Doing 1" }));
    fireEvent.click(screen.getByLabelText("more for draw the chart"));
    screen.getByLabelText("done draw the chart").focus();

    pressFocused("Enter");

    expect(pane.onOpen).not.toHaveBeenCalled();
    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(CHART, "done");
  });

  it("#488 the board footer on a phone drops its key hints", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await boardPane();

    expect(screen.getByTestId("todo-footer").textContent).not.toContain("h l column");
  });

  it("#488 the board footer on a desktop keeps its key hints", async () => {
    await boardPane();

    expect(screen.getByTestId("todo-footer").textContent).toContain("h l column");
  });

  it("#488 the list footer on a phone drops its key hints", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    renderPane();
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());

    expect(screen.getByTestId("todo-footer").textContent).not.toContain("x cycle");
  });
});

describe("refiling one todo (#396)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  /** A daily todo the backend files under FDE, beside one it files nowhere. */
  const SEND = {
    path: DAILY,
    line: 4,
    text: "- [ ] send the invoice",
    project: "02 Projects/FDE",
    shared: false,
  };
  const LOOSE = { path: DAILY, line: 6, text: "- [ ] fix the tap", project: null, shared: false };

  /** The list with its rows drawn. */
  async function listPane(options?: Parameters<typeof renderPane>[0]) {
    const pane = renderPane(options);
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());
    return pane;
  }

  // The pane's keys land on the section and never in CodeMirror, so the two
  // runs differ in the setting alone, which is what A2 and A3 ask to see.
  for (const vim of ["on", "off"]) {
    it(`#396 ${vim === "on" ? "A2" : "A3"} A5 m on a list row hands that one row on, vim ${vim}`, async () => {
      toggleVim();
      if (vim === "on") toggleVim();
      expect(localStorage.getItem("kasten.vim")).toBe(vim);
      const pane = await listPane({ hits: [SEND, LOOSE] });

      pane.press("m");

      expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(SEND);
      expect(pane.onEdit).not.toHaveBeenCalled();
      expect(pane.onCycle).not.toHaveBeenCalled();
    });

    it(`#396 ${vim === "on" ? "A2" : "A3"} A5 m on a board card hands that one card on, vim ${vim}`, async () => {
      toggleVim();
      if (vim === "on") toggleVim();
      expect(localStorage.getItem("kasten.vim")).toBe(vim);
      const pane = await boardPane({ hits: [SEND, LOOSE] });
      pane.press("j");
      expect(pane.cursor()).toContain("fix the tap");

      pane.press("m");

      expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(LOOSE);
    });
  }

  it("#396 A4 a phone's row strip holds refile, and a tap refiles", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane({ hits: [SEND, LOOSE] });

    fireEvent.click(screen.getByLabelText("more for send the invoice"));
    fireEvent.click(screen.getByLabelText("refile send the invoice"));

    expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(SEND);
  });

  it("#396 A4 a phone's card strip holds refile, and a tap refiles", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane({ hits: [SEND, LOOSE] });

    fireEvent.click(screen.getByLabelText("more for send the invoice"));
    fireEvent.click(screen.getByLabelText("refile send the invoice"));

    expect(pane.onRefile).toHaveBeenCalledExactlyOnceWith(SEND);
  });

  it("#396 A1 both footers on a desktop name m refile", async () => {
    const pane = await listPane({ hits: [SEND] });
    expect(screen.getByTestId("todo-footer").textContent).toContain("m refile");

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    expect(screen.getByTestId("todo-footer").textContent).toContain("m refile");
  });
});
