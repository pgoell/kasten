import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toggleVim } from "@/lib/editor/vim-setting";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import {
  BOARD,
  boardHooks,
  boardPane,
  CHART,
  DAILY,
  INVOICE,
  lane,
  renderPane,
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
  it("A1 c turns the list into the board and back, and so does board on a touch screen", async () => {
    const pane = renderPane();
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());
    expect(pane.cards()).toHaveLength(0);

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    pane.press("c");
    expect(pane.cards()).toHaveLength(0);
  });

  it("A1 the board button on a touch screen switches to the board and back", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    const button = await screen.findByRole("button", { name: "board" });

    fireEvent.click(button);
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(pane.cards()).toHaveLength(0);
  });

  it("A2 draws the seven columns and leaves out what was finished before the last seven days", async () => {
    const pane = await boardPane();

    expect(pane.columns()).toEqual([
      "Open 3",
      "Doing 1",
      "Review 0",
      "Waiting 0",
      "Blocked 1",
      "Done 1",
      // Folded, Rejected reads as a chevron and its count (#811 F3c), so its name is on the label.
      "› 1",
    ]);
    expect(pane.texts().join()).not.toContain("old idea");
    // Rejected is folded on a desktop by default (#811 A7), so a click draws its card.
    fireEvent.click(screen.getByRole("button", { name: "Rejected 1" }));
    expect(pane.texts().join()).toContain("drop the logo");
  });

  it("A3 lanes by kind, a part taking its parent's, and g switches to lanes by project", async () => {
    const pane = await boardPane();

    expect(pane.headings()).toEqual(["#client", "#internal", "#private", "No kind"]);
    expect(lane("#internal")).toContain("draw the chart");

    pane.press("g");

    expect(pane.headings()).toEqual(["No project", "FDE"]);
    // The invoice by its link, the chart by its folder.
    expect(lane("FDE")).toContain("send the invoice");
    expect(lane("FDE")).toContain("draw the chart");
    expect(lane("No project")).toContain("fix the tap");

    pane.press("g");
    expect(pane.headings()).toEqual(["#client", "#internal", "#private", "No kind"]);
  });

  it("A5 a card shows priority, due date, parts, what it waits for and the parent", async () => {
    const pane = await boardPane();

    const deck = pane.card("write the deck").textContent;
    expect(deck).toContain("⏫");
    expect(deck).toContain("08-12");
    expect(deck).not.toContain("2026-08-12");
    expect(deck).toContain("1/2");
    expect(pane.card("ship it").textContent).toContain("⛔ fix the tap");
    expect(pane.card("draw the chart").textContent).toContain("↳ write the deck");
  });

  it("#541 I4 a card waits on an id two todos carry, though the done twin is listed last", async () => {
    const pane = await boardPane({
      hits: [
        {
          path: DAILY,
          line: 1,
          text: "- [ ] ship the release 🆔 kt-aaaaaa",
          project: null,
          shared: false,
        },
        {
          path: DAILY,
          line: 2,
          text: "- [x] cut the branch 🆔 kt-aaaaaa",
          project: null,
          shared: false,
        },
        {
          path: DAILY,
          line: 3,
          text: "- [b] write the docs ⛔ kt-aaaaaa",
          project: null,
          shared: false,
        },
      ],
    });

    expect(pane.card("write the docs").textContent).toContain("⛔ kt-aaaaaa");
  });

  it("I7 the board reads the archive the pane was opened with", async () => {
    const pane = await boardPane({ archive: true });

    expect(fetchTodos).toHaveBeenCalledWith(true);
    expect(pane.texts().join()).toContain("send the invoice");
  });

  it("#429 A4 a review card sits in a Review column after Doing, in a grid of seven", async () => {
    const pane = await boardPane({
      hits: [
        ...BOARD,
        { path: DAILY, line: 9, text: "- [r] write the parser", project: null, shared: false },
      ],
    });

    expect(pane.columns().slice(0, 3)).toEqual(["Open 3", "Doing 1", "Review 1"]);
    // Seven columns, so the grid and every lane's span count seven. Rejected is
    // folded by default (#811 A7), which narrows its track, so it is unfolded here.
    fireEvent.click(screen.getByRole("button", { name: "Rejected 1" }));
    const grid = screen.getAllByTestId("todo-column")[0]?.parentElement;
    expect(grid?.className).toContain("grid-cols-7");
    expect(grid?.innerHTML).not.toContain("col-span-6");
  });

  it("#429 A4 V moves the card to review through onCycle", async () => {
    const pane = await boardPane();
    expect(pane.cursor()).toContain("send the invoice");

    pane.press("V");

    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(INVOICE, "review");
  });

  it("#429 A4 a phone has a Review tab, and the card's strip sets review on one tap", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const review = {
      path: DAILY,
      line: 9,
      text: "- [r] write the parser",
      project: null,
      shared: false,
    };
    const pane = await boardPane({ hits: [...BOARD, review] });

    fireEvent.click(screen.getByRole("tab", { name: "Review 1" }));
    expect(pane.texts()).toEqual([expect.stringContaining("write the parser")]);

    fireEvent.click(screen.getByRole("tab", { name: "Doing 1" }));
    fireEvent.click(screen.getByLabelText("more for draw the chart"));
    const states = ["open", "doing", "review", "done", "blocked", "waiting", "rejected"];
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter((label) => states.some((one) => label === `${one} draw the chart`));
    expect(labels).toEqual(states.map((one) => `${one} draw the chart`));

    fireEvent.click(screen.getByLabelText("review draw the chart"));
    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(CHART, "review");
  });

  it("A3 the lanes button switches lanes on a touch screen", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    // A lane with nothing in the shown column is drawn folded on a phone (#811 A8), so #private shows.
    expect(pane.headings()).toEqual(["#client", "#internal", "#private", "No kind"]);

    fireEvent.click(screen.getByRole("button", { name: "project" }));
    expect(pane.headings()).toEqual(["No project", "FDE"]);

    fireEvent.click(screen.getByRole("button", { name: "kind" }));
    expect(pane.headings()).toEqual(["#client", "#internal", "#private", "No kind"]);
  });

  it("A3 the lanes button does what g does: cursor to the top, focus on its card", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane({ focusSignal: 1 });
    pane.press("j");
    expect(pane.cursor()).toContain("write the deck");

    const lanes = screen.getByRole("button", { name: "project" });
    lanes.focus();
    fireEvent.click(lanes);

    // Row 1 would be the deck again, the second card of the open column.
    expect(pane.cursor()).toContain("fix the tap");
    expect(document.activeElement?.textContent).toContain("fix the tap");
  });

  it("B5 two project folders of one name under two roots draw two lanes", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const pane = await boardPane({
      hits: [
        {
          path: "02 Projects/Foo/a.md",
          line: 1,
          text: "- [ ] one",
          project: "02 Projects/Foo",
          shared: false,
        },
        {
          path: "03 Areas/Foo/b.md",
          line: 1,
          text: "- [ ] two",
          project: "03 Areas/Foo",
          shared: false,
        },
      ],
    });

    pane.press("g");

    expect(pane.headings()).toEqual(["Foo", "Foo"]);
    expect(pane.texts()).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("lanes by the project the backend names (#395, #394)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const KASTEN = "02 Projects/Kasten/plan.md";

  /**
   * In the Kasten folder, but its tag names FDE, and the backend says so. The
   * A4 tests put it beside the deck and its doing part, both FDE by folder.
   */
  const TAGGED = {
    path: KASTEN,
    line: 1,
    text: "- [ ] send the deck #p/fde",
    project: "02 Projects/FDE",
    shared: false,
  };

  it("A2 #395 a daily todo with no link sits in the lane the API names", async () => {
    const pane = await boardPane({
      hits: [
        {
          path: DAILY,
          line: 4,
          text: "- [ ] send the deck",
          project: "02 Projects/FDE",
          shared: false,
        },
        { path: DAILY, line: 6, text: "- [ ] fix the tap", project: null, shared: false },
      ],
    });

    pane.press("g");

    expect(pane.headings()).toEqual(["No project", "FDE"]);
    expect(lane("FDE")).toContain("send the deck");
    expect(lane("No project")).toContain("fix the tap");
  });

  it("A3 #394 a todo tagged #p/fde in the Kasten folder sits in the FDE lane", async () => {
    const pane = await boardPane({
      hits: [
        TAGGED,
        {
          path: KASTEN,
          line: 2,
          text: "- [ ] fix the tap",
          project: "02 Projects/Kasten",
          shared: false,
        },
      ],
    });

    pane.press("g");

    expect(pane.headings()).toEqual(["FDE", "Kasten"]);
    expect(lane("FDE")).toContain("send the deck");
    expect(lane("Kasten")).not.toContain("send the deck");
    expect(lane("Kasten")).toContain("fix the tap");
  });

  // The board never reads the vim setting, its keys landing on the pane, so
  // the two runs below differ in the setting alone.
  for (const vim of ["on", "off"]) {
    it(`A4 #394 g then j k h l reach the tagged card in its FDE lane on a desktop, vim ${vim}`, async () => {
      toggleVim();
      if (vim === "on") toggleVim();
      expect(localStorage.getItem("kasten.vim")).toBe(vim);
      const pane = await boardPane({ hits: [...BOARD.slice(0, 2), TAGGED] });

      pane.press("g");
      expect(pane.headings()).toEqual(["FDE"]);
      expect(lane("FDE")).toContain("send the deck");

      expect(pane.cursor()).toContain("write the deck");
      pane.press("j");
      expect(pane.cursor()).toContain("send the deck");
      pane.press("l");
      expect(pane.cursor()).toContain("draw the chart");
      pane.press("h");
      pane.press("j");
      expect(pane.cursor()).toContain("send the deck");
      pane.press("k");
      expect(pane.cursor()).toContain("write the deck");
      pane.press("j");
      pane.press("Enter");
      expect(pane.onOpen).toHaveBeenLastCalledWith(KASTEN, 1);
    });
  }

  it("A4 #394 a phone shows the tagged card in its FDE lane, one column, lanes by finger", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane({ hits: [...BOARD.slice(0, 2), TAGGED] });

    fireEvent.click(screen.getByRole("button", { name: "project" }));

    expect(pane.headings()).toEqual(["FDE"]);
    expect(screen.getAllByRole("tab")[0]?.textContent).toBe("Open 2");
    expect(pane.texts()).toEqual([
      expect.stringContaining("write the deck"),
      expect.stringContaining("send the deck"),
    ]);
    expect(lane("FDE")).toContain("send the deck");

    fireEvent.click(pane.card("send the deck"));
    expect(pane.onOpen).toHaveBeenCalledWith(KASTEN, 1);
  });
});
